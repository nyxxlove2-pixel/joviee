// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

// Glue code between CodeMirror and Tern.
//
// Create a CodeMirror.TernServer to wrap an actual Tern server,
// register open documents (CodeMirror.Doc instances) with it, and
// call its methods to activate the assisting functions that Tern
// provides.
//
// Options supported (all optional):
// * defs: An array of JSON definition data structures.
// * plugins: An object mapping plugin names to configuration
//   options.
// * getFile: A function(name, c) that can be used to access files in
//   the project that haven't been loaded yet. Simply do c(null) to
//   indicate that a file is not available.
// * fileFilter: A function(value, docName, doc) that will be applied
//   to documents before passing them on to Tern.
// * switchToDoc: A function(name, doc) that should, when providing a
//   multi-file view, switch the view or focus to the named file.
// * showError: A function(editor, message) that can be used to
//   override the way errors are displayed.
// * completionTip: Customize the content in tooltips for completions.
//   Is passed a single argumentâ€”the completion's data as returned by
//   Ternâ€”and may return a string, DOM node, or null to indicate that
//   no tip should be shown. By default the docstring is shown.
// * typeTip: Like completionTip, but for the tooltips shown for type
//   queries.
// * responseFilter: A function(doc, query, request, error, data) that
//   will be applied to the Tern responses before treating them
//
//
// It is possible to run the Tern server in a web worker by specifying
// these additional options:
// * useWorker: Set to true to enable web worker mode. You'll probably
//   want to feature detect the actual value you use here, for example
//   !!window.Worker.
// * workerScript: The main script of the worker. Point this to
//   wherever you are hosting worker.js from this directory.
// * workerDeps: An array of paths pointing (relative to workerScript)
//   to the Acorn and Tern libraries and any Tern plugins you want to
//   load. Or, if you minified those into a single script and included
//   them in the workerScript, simply leave this undefined.

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";
  // declare global: tern

  CodeMirror.TernServer = function(options) {
    var self = this;
    this.options = options || {};
    var plugins = this.options.plugins || (this.options.plugins = {});
    if (!plugins.doc_comment) plugins.doc_comment = true;
    this.docs = Object.create(null);
    if (this.options.useWorker) {
      this.server = new WorkerServer(this);
    } else {
      this.server = new tern.Server({
        getFile: function(name, c) { return getFile(self, name, c); },
        async: true,
        defs: this.options.defs || [],
        plugins: plugins
      });
    }
    this.trackChange = function(doc, change) { trackChange(self, doc, change); };

    this.cachedArgHints = null;
    this.activeArgHints = null;
    this.jumpStack = [];

    this.getHint = function(cm, c) { return hint(self, cm, c); };
    this.getHint.async = true;
  };

  CodeMirror.TernServer.prototype = {
    addDoc: function(name, doc) {
      var data = {doc: doc, name: name, changed: null};
      this.server.addFile(name, docValue(this, data));
      CodeMirror.on(doc, "change", this.trackChange);
      return this.docs[name] = data;
    },

    delDoc: function(id) {
      var found = resolveDoc(this, id);
      if (!found) return;
      CodeMirror.off(found.doc, "change", this.trackChange);
      delete this.docs[found.name];
      this.server.delFile(found.name);
    },

    hideDoc: function(id) {
      closeArgHints(this);
      var found = resolveDoc(this, id);
      if (found && found.changed) sendDoc(this, found);
    },

    complete: function(cm) {
      cm.showHint({hint: this.getHint});
    },

    showType: function(cm, pos, c) { showContextInfo(this, cm, pos, "type", c); },

    showDocs: function(cm, pos, c) { showContextInfo(this, cm, pos, "documentation", c); },

    updateArgHints: function(cm) { updateArgHints(this, cm); },

    jumpToDef: function(cm) { jumpToDef(this, cm); },

    jumpBack: function(cm) { jumpBack(this, cm); },

    rename: function(cm) { rename(this, cm); },

    selectName: function(cm) { selectName(this, cm); },

    request: function (cm, query, c, pos) {
      var self = this;
      var doc = findDoc(this, cm.getDoc());
      var request = buildRequest(this, doc, query, pos);
      var extraOptions = request.query && this.options.queryOptions && this.options.queryOptions[request.query.type]
      if (extraOptions) for (var prop in extraOptions) request.query[prop] = extraOptions[prop];

      this.server.request(request, function (error, data) {
        if (!error && self.options.responseFilter)
          data = self.options.responseFilter(doc, query, request, error, data);
        c(error, data);
      });
    },

    destroy: function () {
      closeArgHints(this)
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    }
  };

  var Pos = CodeMirror.Pos;
  var cls = "CodeMirror-Tern-";
  var bigDoc = 250;

  function getFile(ts, name, c) {
    var buf = ts.docs[name];
    if (buf)
      c(docValue(ts, buf));
    else if (ts.options.getFile)
      ts.options.getFile(name, c);
    else
      c(null);
  }

  function findDoc(ts, doc, name) {
    for (var n in ts.docs) {
      var cur = ts.docs[n];
      if (cur.doc == doc) return cur;
    }
    if (!name) for (var i = 0;; ++i) {
      n = "[doc" + (i || "") + "]";
      if (!ts.docs[n]) { name = n; break; }
    }
    return ts.addDoc(name, doc);
  }

  function resolveDoc(ts, id) {
    if (typeof id == "string") return ts.docs[id];
    if (id instanceof CodeMirror) id = id.getDoc();
    if (id instanceof CodeMirror.Doc) return findDoc(ts, id);
  }

  function trackChange(ts, doc, change) {
    var data = findDoc(ts, doc);

    var argHints = ts.cachedArgHints;
    if (argHints && argHints.doc == doc && cmpPos(argHints.start, change.to) >= 0)
      ts.cachedArgHints = null;

    var changed = data.changed;
    if (changed == null)
      data.changed = changed = {from: change.from.line, to: change.from.line};
    var end = change.from.line + (change.text.length - 1);
    if (change.from.line < changed.to) changed.to = changed.to - (change.to.line - end);
    if (end >= changed.to) changed.to = end + 1;
    if (changed.from > change.from.line) changed.from = change.from.line;

    if (doc.lineCount() > bigDoc && change.to - changed.from > 100) setTimeout(function() {
      if (data.changed && data.changed.to - data.changed.from > 100) sendDoc(ts, data);
    }, 200);
  }

  function sendDoc(ts, doc) {
    ts.server.request({files: [{type: "full", name: doc.name, text: docValue(ts, doc)}]}, function(error) {
      if (error) window.console.error(error);
      else doc.changed = null;
    });
  }

  // Completion

  function hint(ts, cm, c) {
    ts.request(cm, {type: "completions", types: true, docs: true, urls: true}, function(error, data) {
      if (error) return showError(ts, cm, error);
      var completions = [], after = "";
      var from = data.start, to = data.end;
      if (cm.getRange(Pos(from.line, from.ch - 2), from) == "[\"" &&
          cm.getRange(to, Pos(to.line, to.ch + 2)) != "\"]")
        after = "\"]";

      for (var i = 0; i < data.completions.length; ++i) {
        var completion = data.completions[i], className = typeToIcon(completion.type);
        if (data.guess) className += " " + cls + "guess";
        completions.push({text: completion.name + after,
                          displayText: completion.displayName || completion.name,
                          className: className,
                          data: completion});
      }

      var obj = {from: from, to: to, list: completions};
      var tooltip = null;
      CodeMirror.on(obj, "close", function() { remove(tooltip); });
      CodeMirror.on(obj, "update", function() { remove(tooltip); });
      CodeMirror.on(obj, "select", function(cur, node) {
        remove(tooltip);
        var content = ts.options.completionTip ? ts.options.completionTip(cur.data) : cur.data.doc;
        if (content) {
          tooltip = makeTooltip(node.parentNode.getBoundingClientRect().right + window.pageXOffset,
                                node.getBoundingClientRect().top + window.pageYOffset, content, cm, cls + "hint-doc");
        }
      });
      c(obj);
    });
  }

  function typeToIcon(type) {
    var suffix;
    if (type == "?") suffix = "unknown";
    else if (type == "number" || type == "string" || type == "bool") suffix = type;
    else if (/^fn\(/.test(type)) suffix = "fn";
    else if (/^\[/.test(type)) suffix = "array";
    else suffix = "object";
    return cls + "completion " + cls + "completion-" + suffix;
  }

  // Type queries

  function showContextInfo(ts, cm, pos, queryName, c) {
    ts.request(cm, queryName, function(error, data) {
      if (error) return showError(ts, cm, error);
      if (ts.options.typeTip) {
        var tip = ts.options.typeTip(data);
      } else {
        var tip = elt("span", null, elt("strong", null, data.type || "not found"));
        if (data.doc)
          tip.appendChild(document.createTextNode(" â€” " + data.doc));
        if (data.url) {
          tip.appendChild(document.createTextNode(" "));
          var child = tip.appendChild(elt("a", null, "[docs]"));
          child.href = data.url;
          child.target = "_blank";
        }
      }
      tempTooltip(cm, tip, ts);
      if (c) c();
    }, pos);
  }

  // Maintaining argument hints

  function updateArgHints(ts, cm) {
    closeArgHints(ts);

    if (cm.somethingSelected()) return;
    var state = cm.getTokenAt(cm.getCursor()).state;
    var inner = CodeMirror.innerMode(cm.getMode(), state);
    if (inner.mode.name != "javascript") return;
    var lex = inner.state.lexical;
    if (lex.info != "call") return;

    var ch, argPos = lex.pos || 0, tabSize = cm.getOption("tabSize");
    for (var line = cm.getCursor().line, e = Math.max(0, line - 9), found = false; line >= e; --line) {
      var str = cm.getLine(line), extra = 0;
      for (var pos = 0;;) {
        var tab = str.indexOf("\t", pos);
        if (tab == -1) break;
        extra += tabSize - (tab + extra) % tabSize - 1;
        pos = tab + 1;
      }
      ch = lex.column - extra;
      if (str.charAt(ch) == "(") {found = true; break;}
    }
    if (!found) return;

    var start = Pos(line, ch);
    var cache = ts.cachedArgHints;
    if (cache && cache.doc == cm.getDoc() && cmpPos(start, cache.start) == 0)
      return showArgHints(ts, cm, argPos);

    ts.request(cm, {type: "type", preferFunction: true, end: start}, function(error, data) {
      if (error || !data.type || !(/^fn\(/).test(data.type)) return;
      ts.cachedArgHints = {
        start: start,
        type: parseFnType(data.type),
        name: data.exprName || data.name || "fn",
        guess: data.guess,
        doc: cm.getDoc()
      };
      showArgHints(ts, cm, argPos);
    });
  }

  function showArgHints(ts, cm, pos) {
    closeArgHints(ts);

    var cache = ts.cachedArgHints, tp = cache.type;
    var tip = elt("span", cache.guess ? cls + "fhint-guess" : null,
                  elt("span", cls + "fname", cache.name), "(");
    for (var i = 0; i < tp.args.length; ++i) {
      if (i) tip.appendChild(document.createTextNode(", "));
      var arg = tp.args[i];
      tip.appendChild(elt("span", cls + "farg" + (i == pos ? " " + cls + "farg-current" : ""), arg.name || "?"));
      if (arg.type != "?") {
        tip.appendChild(document.createTextNode(":\u00a0"));
        tip.appendChild(elt("span", cls + "type", arg.type));
      }
    }
    tip.appendChild(document.createTextNode(tp.rettype ? ") ->\u00a0" : ")"));
    if (tp.rettype) tip.appendChild(elt("span", cls + "type", tp.rettype));
    var place = cm.cursorCoords(null, "page");
    var tooltip = ts.activeArgHints = makeTooltip(place.right + 1, place.bottom, tip, cm)
    setTimeout(function() {
      tooltip.clear = onEditorActivity(cm, function() {
        if (ts.activeArgHints == tooltip) closeArgHints(ts) })
    }, 20)
  }

  function parseFnType(text) {
    var args = [], pos = 3;

    function skipMatching(upto) {
      var depth = 0, start = pos;
      for (;;) {
        var next = text.charAt(pos);
        if (upto.test(next) && !depth) return text.slice(start, pos);
        if (/[{\[\(]/.test(next)) ++depth;
        else if (/[}\]\)]/.test(next)) --depth;
        ++pos;
      }
    }

    // Parse arguments
    if (text.charAt(pos) != ")") for (;;) {
      var name = text.slice(pos).match(/^([^, \(\[\{]+): /);
      if (name) {
        pos += name[0].length;
        name = name[1];
      }
      args.push({name: name, type: skipMatching(/[\),]/)});
      if (text.charAt(pos) == ")") break;
      pos += 2;
    }

    var rettype = text.slice(pos).match(/^\) -> (.*)$/);

    return {args: args, rettype: rettype && rettype[1]};
  }

  // Moving to the definition of something

  function jumpToDef(ts, cm) {
    function inner(varName) {
      var req = {type: "definition", variable: varName || null};
      var doc = findDoc(ts, cm.getDoc());
      ts.server.request(buildRequest(ts, doc, req), function(error, data) {
        if (error) return showError(ts, cm, error);
        if (!data.file && data.url) { window.open(data.url); return; }

        if (data.file) {
          var localDoc = ts.docs[data.file], found;
          if (localDoc && (found = findContext(localDoc.doc, data))) {
            ts.jumpStack.push({file: doc.name,
                               start: cm.getCursor("from"),
                               end: cm.getCursor("to")});
            moveTo(ts, doc, localDoc, found.start, found.end);
            return;
          }
        }
        showError(ts, cm, "Could not find a definition.");
      });
    }

    if (!atInterestingExpression(cm))
      dialog(cm, "Jump to variable", function(name) { if (name) inner(name); });
    else
      inner();
  }

  function jumpBack(ts, cm) {
    var pos = ts.jumpStack.pop(), doc = pos && ts.docs[pos.file];
    if (!doc) return;
    moveTo(ts, findDoc(ts, cm.getDoc()), doc, pos.start, pos.end);
  }

  function moveTo(ts, curDoc, doc, start, end) {
    doc.doc.setSelection(start, end);
    if (curDoc != doc && ts.options.switchToDoc) {
      closeArgHints(ts);
      ts.options.switchToDoc(doc.name, doc.doc);
    }
  }

  // The {line,ch} representation of positions makes this rather awkward.
  function findContext(doc, data) {
    var before = data.context.slice(0, data.contextOffset).split("\n");
    var startLine = data.start.line - (before.length - 1);
    var start = Pos(startLine, (before.length == 1 ? data.start.ch : doc.getLine(startLine).length) - before[0].length);

    var text = doc.getLine(startLine).slice(start.ch);
    for (var cur = startLine + 1; cur < doc.lineCount() && text.length < data.context.length; ++cur)
      text += "\n" + doc.getLine(cur);
    if (text.slice(0, data.context.length) == data.context) return data;

    var cursor = doc.getSearchCursor(data.context, 0, false);
    var nearest, nearestDist = Infinity;
    while (cursor.findNext()) {
      var from = cursor.from(), dist = Math.abs(from.line - start.line) * 10000;
      if (!dist) dist = Math.abs(from.ch - start.ch);
      if (dist < nearestDist) { nearest = from; nearestDist = dist; }
    }
    if (!nearest) return null;

    if (before.length == 1)
      nearest.ch +=YT"×È`È`DŸ	       ®  	   	  ¹ ¨  ! Ô¨E²õ¼qÃµ’Şıç©Ø¡q¨>!WÕaD°-ÅÔ% Ô¨E²õ¼qÃµ’Şıç©Ø¡q¨>!WÕaD°-ÅÔş @Microsoft-Windows-Identity-Foundation-Opt-Package~31bf3856ad364e35~amd64~~10.0.22621.1.cat|! ÚÀ)—ˆÚGÊ÷÷Rë…ã¾¾x··Ùş‡ğjn©ò[% ÚÀ)—ˆÚGÊ÷÷Rë…ã¾¾x··Ùş‡ğjn©ò[ş @Microsoft-Windows-Client-Features-Package0211~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Features-Package0211~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-Package0211~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ßÒ£tîŒ¡é-ËŒ¹çùz¸•-ËÚÊRÙ¢ß% ßÒ£tîŒ¡é-ËŒ¹çùz¸•-ËÚÊRÙ¢ßş @Microsoft-Windows-Client-Desktop-Required-WOW64-Package0010~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0010~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0010~31bf3856ad364e35~amd64~~10.0.22621.4037.cat|! àÈY;¡@GÎK,cÔƒçOÀ×j÷*Ğ‹Æ1Âã% àÈY;¡@GÎK,cÔƒçOÀ×j÷*Ğ‹Æ1Âãş @Microsoft-Windows-Security-SPP-Component-SKU-Professional-License-Package~31bf3856ad364e35~amd64~~10.0.22621.3527.cat|Microsoft-Windows-Security-SPP-Component-SKU-Professional-License-Package~31bf3856ad364e35~amd64~~10.0.22621.3810.cat|Microsoft-Windows-Security-SPP-Component-SKU-Professional-License-Package~31bf3856ad364e35~amd64~~10.0.22621.3958.cat|! á¤´h3åQê¡“™Ç1´ıÀÆ=v«9=¹¬% á¤´h3åQê¡“™Ç1´ıÀÆ=v«9=¹¬ş @Microsoft-Windows-Client-Desktop-Required-Package0114~31bf3856ad364e35~amd64~en-US~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-Package0114~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package0114~31bf3856ad364e35~amd64~en-US~10.0.22621.4037.cat|                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       ‚7%¯ˆ#…"[¨ ¨       ÅlËdás	     I(  B$  	   Ø'	 ¨  ! ¡ô³dC’m`„úÜëœš »|Æ~éOz£ï9I% ¡ô³dC’m`„úÜëœš »|Æ~éOz£ï9Iş @Microsoft-Windows-Client-Desktop-Required-Package0517~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|! ¡õ®ñ¸:ÅÃp³²§c‚]jNÒğïİWç$^ï Ù% ¡õ®ñ¸:ÅÃp³²§c‚]jNÒğïİWç$^ï Ùş @Microsoft-Windows-Holographic-Desktop-Merged-WOW64-merged-Package~31bf3856ad364e35~amd64~~10.0.22621.3672.cat|! ¡õŞ›q½°3Ô™~ïœ PH2üÛ4×/áÃ% ¡õŞ›q½°3Ô™~ïœ PH2üÛ4×/áÃş @Microsoft-Windows-Client-Desktop-Required-Package02~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-Package02~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package02~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ¡ò¾¾æÀßÛ/¢Õ‚dùóBû½ö‰è6ì§ç oŞâ;% ¡ò¾¾æÀßÛ/¢Õ‚dùóBû½ö‰è6ì§ç oŞâ;ş @Microsoft-Windows-Client-Desktop-Required-Package05111~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-Package05111~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package05111~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ¡ôKÉ‡‰h$ëY'Mvmêá¼½Íù¡Ú.WêTšQZª% ¡ôKÉ‡‰h$ëY'Mvmêá¼½Íù¡Ú.WêTšQZªş @Microsoft-Windows-Client-Desktop-Required-Package05110~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-Package05110~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package05110~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.4037.cat|! ¡óÕuP1¬Vö‹€“Ó€IWôÚ,âí]¥O±ô¸% ¡óÕuP1¬Vö‹€“Ó€IWôÚ,âí]¥O±ô¸ş @Microsoft-Windows-Client-Features-Package0210~31bf3856ad364e35~amd64~~10.0.22621.3672.cat|Microsoft-Windows-Client-Features-Package0210~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-Package0210~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ¡ô—öRpNBi+è%‚á³ŠH¼Ió„}Êe'$% ¡ô—öRpNBi+è%‚á³ŠH¼Ió„}Êe'$ş @Microsoft-Windows-Client-Features-Package0213~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Features-Package0213~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-Package0213~31bf3856ad364e35~amd64~~10.0.22621.4037.cat|! ¡ğ«dÃÖ¦¯ØHµô•ÎÂ&uaé­g*±ü(º% ¡ğ«dÃÖ¦¯ØHµô•ÎÂ&uaé­g*±ü(ºş @Microsoft-Windows-Client-Desktop-Required-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.4037.cat|osoft-Windows-Client-Desktop-Required-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package05110~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.4037.cat|! ¡óÕuP1¬Vö‹€“Ó€IWôÚ,âí]¥O±ô¸% ¡óÕuP1¬Vö‹€“Ó€IWôÚ,âí]¥O±ô¸ş @Microsoft-Windows-Client-Features-Package0210~31bf3856ad364e35~amd64~~10.0.22621.3672.cat|Microsoft-Windows-Client-Features-Package0210~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-Package0210~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ¡ô—öRpNBi+è%‚á³ŠH¼Ió„}Êe'$% ¡ô—öRpNBi+è%‚á³ŠH¼Ió„}Êe'$ş @Microsoft-Windows-Client-Features-Package0213~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Features-Package0213~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-Package0213~31bf3856ad364e35~amd64~~10.0.22621.4037.cat|at|lient-Features-WOW64-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3672.cat|                                                   ´ ì%¯ =%° U.,%$¬ y#² •)¢ ì+|(» ¯ mj!¯   ®M$[V([û&v×"v±)    Z4ûÉYÉY–	     5*  Ê%  	   í“ ( ! ¬”ĞÔä3°ù³[É
M»äÀ¤ahõb«öóŒ% ¬”ĞÔä3°ù³[É
M»äÀ¤ahõb«öóŒş @Microsoft-Windows-NetFx4-US-OC-Package~31bf3856ad364e35~amd64~~10.0.22621.3085.cat|! ¬˜rX(B|Ó½ªáQ÷æ§Ÿ¥œÖ­Û0ª•Nİ³¤®% ¬˜rX(B|Ó½ªáQ÷æ§Ÿ¥œÖ­Û0ª•Nİ³¤®ş @Microsoft-Windows-Client-Desktop-Required-WOW64-Package0011~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0011~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|! ¬•V<Á¦´ª¡Š[ª^–“±1cc¡ËéÆ™ˆÙ
% ¬•V<Á¦´ª¡Š[ª^–“±1cc¡ËéÆ™ˆÙ
ş @Microsoft-Windows-NetFx3-OnDemand-Package~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-NetFx3-OnDemand-Package~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|! ¬˜IáÍùÄÀ¾´gå¾şÖmDº`ºı°1°¦©İ% ¬˜IáÍùÄÀ¾´gå¾şÖmDº`ºı°1°¦©İş @Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~~10.0.22621.3672.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~~10.0.22621.3810.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ¬“ífÜİùôˆw'œ’×t‹‰Ìİûøñ ˜“Œª% ¬“ífÜİùôˆw'œ’×t‹‰Ìİûøñ ˜“Œªş @Microsoft-Windows-Client-Desktop-Required-Package01112030~31bf3856ad364e35~amd64~en-US~10.0.22621.3447.cat|Microsoft-Windows-Client-Desktop-Required-Package0113~31bf3856ad364e35~amd64~en-US~10.0.22621.3447.cat|Microsoft-Windows-Client-Desktop-Required-Package05111~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-Package05111~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package01112030~31bf3856ad364e35~amd64~en-US~10.0.22621.3810.cat|Microsoft-Windows-Client-Desktop-Required-Package0113~31bf3856ad364e35~amd64~en-US~10.0.22621.3810.cat|Microsoft-Windows-Client-Desktop-Required-Package05111~31bf3856ad364e35~amd64~~10.0.22621.4036.cat|! ¬˜rX(B|Ó½ªáQ÷æ§Ÿ¥œÖ­Û0ª•Nİ³¤®% ¬˜rX(B|Ó½ªáQ÷æ§Ÿ¥œÖ­Û0ª•Nİ³¤®ş @Microsoft-Windows-Client-Desktop-Required-WOW64-Package0011~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0011~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-WOW64-Package0011~31bf3856ad364e35~amd64~~10.0.22621.4037.cat|! ¬•V<Á¦´ª¡Š[ª^–“±1cc¡ËéÆ™ˆÙ
% ¬•V<Á¦´ª¡Š[ª^–“±1cc¡ËéÆ™ˆÙ
ş @Microsoft-Windows-NetFx3-OnD