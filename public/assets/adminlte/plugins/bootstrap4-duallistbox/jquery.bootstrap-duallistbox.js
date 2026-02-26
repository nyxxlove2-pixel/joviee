/*
 *  Bootstrap Duallistbox - v4.0.2
 *  A responsive dual listbox widget optimized for Twitter Bootstrap. It works on all modern browsers and on touch devices.
 *  http://www.virtuosoft.eu/code/bootstrap-duallistbox/
 *
 *  Made by Istv√°n Ujj-M√©sz√°ros
 *  Under Apache License v2.0 License
 */
(function(factory) {
  if (typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = function(root, jQuery) {
      if (jQuery === undefined) {
        if (typeof window !== 'undefined') {
          jQuery = require('jquery');
        }
        else {
          jQuery = require('jquery')(root);
        }
      }
      factory(jQuery);
      return jQuery;
    };
  } else {
    factory(jQuery);
  }
}(function($) {
  // Create the defaults once
  var pluginName = 'bootstrapDualListbox',
    defaults = {
      filterTextClear: 'show all',
      filterPlaceHolder: 'Filter',
      moveSelectedLabel: 'Move selected',
      moveAllLabel: 'Move all',
      removeSelectedLabel: 'Remove selected',
      removeAllLabel: 'Remove all',
      moveOnSelect: true,                                                                 // true/false (forced true on androids, see the comment later)
      moveOnDoubleClick: true,                                                            // true/false (forced false on androids, cause moveOnSelect is forced to true)
      preserveSelectionOnMove: false,                                                     // 'all' / 'moved' / false
      selectedListLabel: false,                                                           // 'string', false
      nonSelectedListLabel: false,                                                        // 'string', false
      helperSelectNamePostfix: '_helper',                                                 // 'string_of_postfix' / false
      selectorMinimalHeight: 100,
      showFilterInputs: true,                                                             // whether to show filter inputs
      nonSelectedFilter: '',                                                              // string, filter the non selected options
      selectedFilter: '',                                                                 // string, filter the selected options
      infoText: 'Showing all {0}',                                                        // text when all options are visible / false for no info text
      infoTextFiltered: '<span class="badge badge-warning">Filtered</span> {0} from {1}', // when not all of the options are visible due to the filter
      infoTextEmpty: 'Empty list',                                                        // when there are no options present in the list
      filterOnValues: false,                                                              // filter by selector's values, boolean
      sortByInputOrder: false,
      eventMoveOverride: false,                                                           // boolean, allows user to unbind default event behaviour and run their own instead
      eventMoveAllOverride: false,                                                        // boolean, allows user to unbind default event behaviour and run their own instead
      eventRemoveOverride: false,                                                         // boolean, allows user to unbind default event behaviour and run their own instead
      eventRemoveAllOverride: false,                                                      // boolean, allows user to unbind default event behaviour and run their own instead
      btnClass: 'btn-outline-secondary',                                                  // sets the button style class for all the buttons
      btnMoveText: '&gt;',                                                                // string, sets the text for the "Move" button
      btnRemoveText: '&lt;',                                                              // string, sets the text for the "Remove" button
      btnMoveAllText: '&gt;&gt;',                                                         // string, sets the text for the "Move All" button
      btnRemoveAllText: '&lt;&lt;'                                                        // string, sets the text for the "Remove All" button
    },
    // Selections are invisible on android if the containing select is styled with CSS
    // http://code.google.com/p/android/issues/detail?id=16922
    isBuggyAndroid = /android/i.test(navigator.userAgent.toLowerCase());

  // The actual plugin constructor
  function BootstrapDualListbox(element, options) {
    this.element = $(element);
    // jQuery has an extend method which merges the contents of two or
    // more objects, storing the result in the first object. The first object
    // is generally empty as we don't want to alter the default options for
    // future instances of the plugin
    this.settings = $.extend({}, defaults, options);
    this._defaults = defaults;
    this._name = pluginName;
    this.init();
  }

  function triggerChangeEvent(dualListbox) {
    dualListbox.element.trigger('change');
  }

  function updateSelectionStates(dualListbox) {
    dualListbox.element.find('option').each(function(index, item) {
      var $item = $(item);
      if (typeof($item.data('original-index')) === 'undefined') {
        $item.data('original-index', dualListbox.elementCount++);
      }
      if (typeof($item.data('_selected')) === 'undefined') {
        $item.data('_selected', false);
      }
    });
  }

  function changeSelectionState(dualListbox, original_index, selected) {
    dualListbox.element.find('option').each(function(index, item) {
      var $item = $(item);
      if ($item.data('original-index') === original_index) {
        $item.prop('selected', selected);
        if(selected){
          $item.attr('data-sortindex', dualListbox.sortIndex);
          dualListbox.sortIndex++;
        } else {
          $item.removeAttr('data-sortindex');
        }
      }
    });
  }

  function formatString(s, args) {
    console.log(s, args);
    return s.replace(/{(\d+)}/g, function(match, number) {
      return typeof args[number] !== 'undefined' ? args[number] : match;
    });
  }

  function refreshInfo(dualListbox) {
    if (!dualListbox.settings.infoText) {
      return;
    }

    var visible1 = dualListbox.elements.select1.find('option').length,
      visible2 = dualListbox.elements.select2.find('option').length,
      all1 = dualListbox.element.find('option').length - dualListbox.selectedElements,
      all2 = dualListbox.selectedElements,
      content = '';

    if (all1 === 0) {
      content = dualListbox.settings.infoTextEmpty;
    } else if (visible1 === all1) {
      content = formatString(dualListbox.settings.infoText, [visible1, all1]);
    } else {
      content = formatString(dualListbox.settings.infoTextFiltered, [visible1, all1]);
    }

    dualListbox.elements.info1.html(content);
    dualListbox.elements.box1.toggleClass('filtered', !(visible1 === all1 || all1 === 0));

    if (all2 === 0) {
      content = dualListbox.settings.infoTextEmpty;
    } else if (visible2 === all2) {
      content = formatString(dualListbox.settings.infoText, [visible2, all2]);
    } else {
      content = formatString(dualListbox.settings.infoTextFiltered, [visible2, all2]);
    }

    dualListbox.elements.info2.html(content);
    dualListbox.elements.box2.toggleClass('filtered', !(visible2 === all2 || all2 === 0));
  }

  function refreshSelects(dualListbox) {
    dualListbox.selectedElements = 0;

    dualListbox.elements.select1.empty();
    dualListbox.elements.select2.empty();

    dualListbox.element.find('option').each(function(index, item) {
      var $item = $(item);
      if ($item.prop('selected')) {
        dualListbox.selectedElements++;
        dualListbox.elements.select2.append($item.clone(true).prop('selected', $item.data('_selected')));
      } else {
        dualListbox.elements.select1.append($item.clone(true).prop('selected', $item.data('_selected')));
      }
    });

    if (dualListbox.settings.showFilterInputs) {
      filter(dualListbox, 1);
      filter(dualListbox, 2);
    }
    refreshInfo(dualListbox);
  }

  function filter(dualListbox, selectIndex) {
    if (!dualListbox.settings.showFilterInputs) {
      return;
    }

    saveSelections(dualListbox, selectIndex);

    dualListbox.elements['select'+selectIndex].empty().scrollTop(0);
    var regex,
      allOptions = dualListbox.element.find('option'),
      options = dualListbox.element;

    if (selectIndex === 1) {
      options = allOptions.not(':selected');
    } else  {
      options = options.find('option:selected');
    }

    try {
      regex = new RegExp($.trim(dualListbox.elements['filterInput'+selectIndex].val()), 'gi');
    }
    catch(e) {
      // a regex to match nothing
      regex = new RegExp('/a^/', 'gi');
    }

    options.each(function(index, item) {
      var $item = $(item),
        isFiltered = true;
      if (item.text.match(regex) || (dualListbox.settings.filterOnValues && $item.attr('value').match(regex) ) ) {
        isFiltered = false;
        dualListbox.elements['select'+selectIndex].append($item.clone(true).prop('selected', $item.data('_selected')));
      }
      allOptions.eq($item.data('original-index')).data('filtered'+selectIndex, isFiltered);
    });

    refreshInfo(dualListbox);
  }

  function saveSelections(dualListbox, selectIndex) {
    var options = dualListbox.element.find('option');
    dualListbox.elements['select'+selectIndex].find('option').each(function(index, item) {
      var $item = $(item);
      options.eq($item.data('original-index')).data('_selected', $item.prop('selected'));
    });
  }

  function sortOptionsByInputOrder(select){
    var selectopt = select.children('option');

    selectopt.sort(function(a,b){
      var an = parseInt(a.getAttribute('data-sortindex')),
          bn = parseInt(b.getAttribute('data-sortindex'));

          if(an > bn) {
             return 1;
          }
          if(an < bn) {
            return -1;
          }
          return 0;
    });

    selectopt.detach().appendTo(select);
  }

  function sortOptions(select, dualListbox) {
    select.find('option').sort(function(a, b) {
      return ($(a).data('original-index') > $(b).data('original-index')) ? 1 : -1;
    }).appendTo(select);

    // workaround for chromium bug: https://bugs.chromium.org/p/chromium/issues/detail?id=1072475
    refreshSelects(dualListbox);
  }

  function clearSelections(dualListbox) {
    dualListbox.elements.select1.find('option').each(function() {
      dualListbox.element.find('option').data('_selected', false);
    });
  }

  function move(dualListbox) {
    if (dualListbox.settings.preserveSelectionOnMove === 'all' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 1);
      saveSelections(dualListbox, 2);
    } else if (dualListbox.settings.preserveSelectionOnMove === 'moved' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 1);
    }

    dualListbox.elements.select1.find('option:selected').each(function(index, item) {
      var $item = $(item);
      if (!$item.data('filtered1')) {
        changeSelectionState(dualListbox, $item.data('original-index'), true);
      }
    });

    refreshSelects(dualListbox);
    triggerChangeEvent(dualListbox);
    if(dualListbox.settings.sortByInputOrder){
        sortOptionsByInputOrder(dualListbox.elements.select2);
    } else {
        sortOptions(dualListbox.elements.select2, dualListbox);
    }
  }

  function remove(dualListbox) {
    if (dualListbox.settings.preserveSelectionOnMove === 'all' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 1);
      saveSelections(dualListbox, 2);
    } else if (dualListbox.settings.preserveSelectionOnMove === 'moved' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 2);
    }

    dualListbox.elements.select2.find('option:selected').each(function(index, item) {
      var $item = $(item);
      if (!$item.data('filtered2')) {
        changeSelectionState(dualListbox, $item.data('original-index'), false);
      }
    });

    refreshSelects(dualListbox);
    triggerChangeEvent(dualListbox);
    sortOptions(dualListbox.elements.select1, dualListbox);
    if(dualListbox.settings.sortByInputOrder){
        sortOptionsByInputOrder(dualListbox.elements.select2);
    }
  }

  function moveAll(dualListbox) {
    if (dualListbox.settings.preserveSelectionOnMove === 'all' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 1);
      saveSelections(dualListbox, 2);
    } else if (dualListbox.settings.preserveSelectionOnMove === 'moved' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 1);
    }

    dualListbox.element.find('option').each(function(index, item) {
      var $item = $(item);
      if (!$item.data('filtered1')) {
        $item.prop('selected', true);
        $item.attr('data-sortindex', dualListbox.sortIndex);
        dualListbox.sortIndex++;
      }
    });

    refreshSelects(dualListbox);
    triggerChangeEvent(dualListbox);
  }

  function removeAll(dualListbox) {
    if (dualListbox.settings.preserveSelectionOnMove === 'all' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 1);
      saveSelections(dualListbox, 2);
    } else if (dualListbox.settings.preserveSelectionOnMove === 'moved' && !dualListbox.settings.moveOnSelect) {
      saveSelections(dualListbox, 2);
    }

    dualListbox.element.find('option').each(function(index, item) {
      var $item = $(item);
      if (!$item.data('filtered2')) {
        $item.prop('selected', false);
        $item.removeAttr('data-sortindex');
      }
    });

    refreshSelects(dualListbox);
    triggerChangeEvent(dualListbox);
  }

  function bindEvents(dualListbox) {
    dualListbox.elements.form.submit(function(e) {
      if (dualListbox.elements.filterInput1.is(':focus')) {
        e.preventDefault();
        dualListbox.elements.filterInput1.focusout();
      } else if (dualListbox.elements.filterInput2.is(':focus')) {
        e.preventDefault();
        dualListbox.elements.filterInput2.focusout();
      }
    });

    dualListbox.element.on('bootstrapDualListbox.refresh', function(e, mustClearSelections){
      dualListbox.refresh(mustClearSelections);
    });

    dualListbox.elements.filterClear1.on('click', function() {
      dualListbox.setNonSelectedFilter('', true);
    });

    dualListbox.elements.filterClear2.on('click', function() {
      dualListbox.setSelectedFilter('', true);
    });

    if (dualListbox.settings.eventMoveOverride === false) {
      dualListbox.elements.moveButton.on('click', function() {
        move(dualListbox);
      });
    }

    if (dualListbox.settings.eventMoveAllOverride === false) {
      dualListbox.elements.moveAllButton.on('click', function() {
        moveAll(dualListbox);
      });
    }

    if (dualListbox.settings.eventRemoveOverride === false) {
      dualListbox.elements.removeButton.on('click', function() {
        remove(dualListbox);
      });
    }

    if (dualListbox.settings.eventRemoveAllOverride === false) {
      dualListbox.elements.removeAllButton.on('click', function() {
        removeAll(dualListbox);
      });
    }

    dualListbox.elements.filterInput1.on('change keyup', function() {
      filter(dualListbox, 1);
    });

    dualListbox.elements.filterInput2.on('change keyup', function() {
      filter(dualListbox, 2);
    });
  }

  BootstrapDualListbox.prototype = {
    init: function () {
      // Add the custom HTML template
      this.container = $('' +
        '<div class="bootstrap-duallistbox-container row">' +
        ' <div class="box1 col-md-6">' +
        '   <label></label>' +
        '   <span class="info-container">' +
        '     <span class="info"></span>' +
        '     <button type="button" class="btn btn-sm clear1" style="float:right!important;"></button>' +
        '   </span>' +
        '   <input class="form-control filter" type="text">' +
        '   <div class="btn-group buttons">' +
        '     <button type="button" class="btn moveall"></button>' +
        '     <button type="button" class="btn move"></button>' +
        '   </div>' +
        '   <select multiple="multiple"></select>' +
        ' </div>' +
        ' <div class="box2 col-md-6">' +
        '   <label></label>' +
        '   <span class="info-container">' +
        '     <span class="info"></span>' +
        '     <button type="button" class="btn btn-sm clear2" style="float:right!important;"></button>' +
        '   </span>' +
        '   <input class="form-control filter" type="text">' +
        '   <div class="btn-group buttons">' +
        '     <button type="button" class="btn remove"></button>' +
        '     <button type="button" class="btn removeall"></button>' +
        '   </div>' +
        '   <select multiple="multiple"></select>' +
        ' </div>' +
        '</div>')
        .insertBefore(this.element);

      // Cache the inner elements
      this.elements = {
        originalSelect: this.element,
        box1: $('.box1', this.container),
        box2: $('.box2', this.container),
        filterInput1: $('.box1 .filter', this.container),
        filterInput2: $('.box2 .filter', this.container),
        filterClear1: $('.box1 .clear1', this.container),
        filterClear2: $('.box2 .clear2', this.container),
        label1: $('.box1 > label', this.container),
        label2: $('.box2 > label', this.container),
        info1: $('.box1 .info', this.container),
        info2: $('.box2 .info', this.container),
        select1: $('.box1 select', this.container),
        select2: $('.box2 select', this.container),
        moveButton: $('.box1 .move', this.container),
        removeButton: $('.box2 .remove', this.container),
        moveAllButton: $('.box1 .moveall', this.container),
        removeAllButton: $('.box2 .removeall', this.container),
        form: $($('.box1 .filter', this.container)[0].form)
      };

      // Set select IDs
      this.originalSelectName = this.element.attr('name') || '';
      var select1Id = 'bootstrap-duallistbox-nonselected-list_' + this.originalSelectName,
        select2Id = 'bootstrap-duallistbox-selected-list_' + this.originalSelectName;
      this.elements.select1.attr('id', select1Id);
      this.elements.select2.attr('id', select2Id);
      this.elements.label1.attr('for', select1Id);
      this.elements.label2.attr('for', select2Id);

      // Apply all settings
      this.selectedElements = 0;
      this.sortIndex = 0;
      this.elementCount = 0;
      this.setFilterTextClear(this.settings.filterTextClear);
      this.setFilterPlaceHolder(this.settings.filterPlaceHolder);
      this.setMoveSelectedLabel(this.settings.moveSelectedLabel);
      this.setMoveAllLabel(this.settings.moveAllLabel);
      this.setRemoveSelectedLabel(this.settings.removeSelectedLabel);
      this.setRemoveAllLabel(this.settings.removeAllLabel);
      this.setMoveOnSelect(this.settings.moveOnSelect);
      this.setMoveOnDoubleClick(this.settings.moveOnDoubleClick);
      this.setPreserveSelectionOnMove(this.settings.preserveSelectionOnMove);
      this.setSelectedListLabel(this.settings.selectedListLabel);
      this.setNonSelectedListLabel(this.settings.nonSelectedListLabel);
      this.setHelperSelectNamePostfix(this.settings.helperSelectNamePostfix);
      this.setSelectOrMinimalHeight(this.settings.selectorMinimalHeight);

      updateSelectionStates(this);

      this.setShowFilterInputs(this.settings.showFilterInputs);
      this.setNonSelectedFilter(this.settings.nonSelectedFilter);
      this.setSelectedFilter(this.settings.selectedFilter);
      this.setInfoText(this.settings.infoText);
      this.setInfoTextFiltered(this.settings.infoTextFiltered);
      this.setInfoTextEmpty(this.settings.infoTextEmpty);
      this.setFilterOnValues(this.settings.filterOnValues);
      this.setSortByInputOrder(this.settings.sortByInputOrder);
      this.setEventMoveOverride(this.settings.eventMoveOverride);
      this.setEventMoveAllOverride(this.settings.eventMoveAllOverride);
      this.setEventRemoveOverride(this.settings.eventRemoveOverride);
      this.setEventRemoveAllOverride(this.settings.eventRemoveAllOverride);
      this.setBtnClass(this.settings.btnClass);
      this.setBtnMoveText(this.settings.btnMoveText);
      this.setBtnRemoveText(this.settings.btnRemoveText);
      this.setBtnMoveAllText(this.settings.btnMoveAllText);
      this.setBtnRemoveAllText(this.settings.btnRemoveAllText);

      // Hide the original select
      this.element.hide();

      bindEvents(this);
      refreshSelects(this);

      return this.element;
    },
    setFilterTextClear: function(value, refresh) {
      this.settings.filterTextClear = value;
      this.elements.filterClear1.html(value);
      this.elements.filterClear2.html(value);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setFilterPlaceHolder: function(value, refresh) {
      this.settings.filterPlaceHolder = value;
      this.elements.filterInput1.attr('placeholder', value);
      this.elements.filterInput2.attr('placeholder', value);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setMoveSelectedLabel: function(value, refresh) {
      this.settings.moveSelectedLabel = value;
      this.elements.moveButton.attr('title', value);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setMoveAllLabel: function(value, refresh) {
      this.settings.moveAllLabel = value;
      this.elements.moveAllButton.attr('title', value);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setRemoveSelectedLabel: function(value, refresh) {
      this.settings.removeSelectedLabel = value;
      this.elements.removeButton.attr('title', value);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setRemoveAllLabel: function(value, refresh) {
      this.settings.removeAllLabel = value;
      this.elements.removeAllButton.attr('title', value);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setMoveOnSelect: function(value, refresh) {
      if (isBuggyAndroid) {
        value = true;
      }
      this.settings.moveOnSelect = value;
      if (this.settings.moveOnSelect) {
        this.container.addClass('moveonselect');
        var self = this;
        this.elements.select1.on('change', function() {
          move(self);
        });
        this.elements.select2.on('change', function() {
          remove(self);
        });
        this.elements.moveButton.detach();
        this.elements.removeButton.detach();
      } else {
        this.container.removeClass('moveonselect');
        this.elements.select1.off('change');
        this.elements.select2.off('change');
        this.elements.moveButton.insertAfter(this.elements.moveAllButton);
        this.elements.removeButton.insertBefore(this.elements.removeAllButton);
      }
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setMoveOnDoubleClick: function(value, refresh) {
      if (isBuggyAndroid) {
        value = false;
      }
      this.settings.moveOnDoubleClick = value;
      if (this.settings.moveOnDoubleClick) {
        this.container.addClass('moveondoubleclick');
        var self = this;
        this.elements.select1.on('dblclick', function() {
          move(self);
        });
        this.elements.select2.on('dblclick', function() {
          remove(self);
        });
      } else {
        this.container.removeClass('moveondoubleclick');
        this.elements.select1.off('dblclick');
        this.elements.select2.off('dblclick');
      }
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setPreserveSelectionOnMove: function(value, refresh) {
      // We are forcing to move on select and disabling preserveSelectionOnMove on Android
      if (isBuggyAndroid) {
        value = false;
      }
      this.settings.preserveSelectionOnMove = value;
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setSelectedListLabel: function(value, refresh) {
      this.settings.selectedListLabel = value;
      if (value) {
        this.elements.label2.show().html(value);
      } else {
        this.elements.label2.hide().html(value);
      }
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setNonSelectedListLabel: function(value, refresh) {
      this.settings.nonSelectedListLabel = value;
      if (value) {
        this.elements.label1.show().html(value);
      } else {
        this.elements.label1.hide().html(value);
      }
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setHelperSelectNamePostfix: function(value, refresh) {
      this.settings.helperSelectNamePostfix = value;
      if (value) {
        this.elements.select1.attr('name', this.originalSelectName + value + '1');
        this.elements.select2.attr('name', this.originalSelectName + value + '2');
      } else {
        this.elements.select1.removeAttr('name');
        this.elements.select2.removeAttr('name');
      }
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setSelectOrMinimalHeight: function(value, refresh) {
      this.settings.selectorMinimalHeight = value;
      var height = this.element.height();
      if (this.element.height() < value) {
        height = value;
      }
      this.elements.select1.height(height);
      this.elements.select2.height(height);
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setShowFilterInputs: function(value, refresh) {
      if (!value) {
        this.setNonSelectedFilter('');
        this.setSelectedFilter('');
        refreshSelects(this);
        this.elements.filterInput1.hide();
        this.elements.filterInput2.hide();
      } else {
        this.elements.filterInput1.show();
        this.elements.filterInput2.show();
      }
      this.settings.showFilterInputs = value;
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setNonSelectedFilter: function(value, refresh) {
      if (this.settings.showFilterInputs) {
        this.settings.nonSelectedFilter = value;
        this.elements.filterInput1.val(value);
        if (refresh) {
          refreshSelects(this);
        }
        return this.element;
      }
    },
    setSelectedFilter: function(value, refresh) {
      if (this.settings.showFilterInputs) {
        this.settings.selectedFilter = value;
        this.elements.filterInput2.val(value);
        if (refresh) {
          refreshSelects(this);
        }
        return this.element;
      }
    },
    setInfoText: function(value, refresh) {
      this.settings.infoText = value;
      if (value) {
        this.elements.info1.show();
        this.elements.info2.show();
      } else {
        this.elements.info1.hide();
        this.elements.info2.hide();
      }
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setInfoTextFiltered: function(value, refresh) {
      this.settings.infoTextFiltered = value;
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setInfoTextEmpty: function(value, refresh) {
      this.settings.infoTextEmpty = value;
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setFilterOnValues: function(value, refresh) {
      this.settings.filterOnValues = value;
      if (refresh) {
        refreshSelects(this);
      }
      return this.element;
    },
    setSortByInputOrder: function(value, refresh){
        this.settings.sortByInputOrder = value;
        if (refresh) {
          refreshSelects(this);
        }
        return this.element;
    },
    setEventMoveOverride: function(value, refresh) {
        this.settings.eventMoveOverride = value;
        if (refresh) {
          refreshSelects(this);
        }
        return this.element;
    },
    setEventMoveAllOverride: function(value, refresh) {
        this.settings.eventMoveAllOverride = value;
        if (refresh) {
          refreshSelects(this);
       ê§vê’Y*&Êz	     Ù#  Ù      ≥7√	 ®   %eÇE¶∞õÙ6b71^ªéN %eÇE¶∞õÙ6b71^ªéN˛ @Microsoft-Windows-Client-Desktop-Required-Package0515~31bf3856ad364e35~amd64~~10.0.22621.3672.cat| %hè–˙œÊASáÜ+U†
#Ú %hè–˙œÊASáÜ+U†
#Ú˛ @Microsoft-Windows-Client-Desktop-Required-Package051420~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|Microsoft-Windows-Client-Desktop-Required-Package0516~31bf3856ad364e35~amd64~~10.0.22621.3737.cat|Microsoft-Windows-Client-Features-Package02~31bf3856ad364e35~amd64~~10.0.22621.3737.cat| %dÈZú•¥bˇR6«≥s2Ô(< %dÈZú•¥bˇR6«≥s2Ô(<˛ @wd_igd.cat| %h{Br˜8L–R¬aaƒµ  %h{Br˜8L–R¬aaƒµ ˛ @Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.3672.cat|Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat| %g íZXﬁæÎ+˛ˇ“?j—H %g íZXﬁæÎ+˛ˇ“?j—H˛ @Microsoft-Windows-Client-Features-Package01~31bf3856ad364e35~amd64~en-US~10.0.22621.2506.cat|Microsoft-Windows-EnterpriseClientSync-Host-Opt-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.1.cat|Microsoft-Windows-GroupPolicy-ClientTools-merged-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3733.cat|Microsoft-Windows-GroupPolicy-ClientTools-merged-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat| %`XÚŒËºY◊è—VXç7dñ %`XÚŒËºY◊è—VXç7dñ˛ @Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat| %bc≥Ò$ì∞.æ∑\ã#Ç# %bc≥Ò$ì∞.æ∑\ã#Ç#˛ @Microsoft-Office-ClickToRun-57F8BBFF-CE63-4B94-B9EB-403DF995BC28-stream.x64.x-none.dat.cat| %iªî# z2˝m~@WÜ†π %iªî# z2˝m~@WÜ†π˛ @Microsoft-Windows-Client-Features-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.3733.cat|Microsoft-Windows-Client-Features-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-WOW64-Package0012~31bf3856ad364e35~amd64~~10.0.22621.4036.cat| %h{Br˜8L–R¬aaƒµ  %h{Br˜8L–R¬aaƒµ ˛ @Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.3672.cat|Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat|Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.4036.cat| %g íZXﬁæÎ+˛ˇ“?j—H %g íZXﬁæÎ+˛ˇ“?j—H˛ @Microsoft-Windows-Client-Features-Package01~31bf3856ad364e35~amd64~en-US~10.0.22621.2506.cat|Microsoft-Windows-EnterpriseClientSync-Host-Opt-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.1.cat|Microsoft-Windows-GroupPolicy-ClientTools-merged-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3733.cat|Microsoft-Windows-GroupPolicy-ClientTools-merged-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat|Microsoft-Windows-GroupPolicy-ClientTools-merged-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.4036.cat| %`XÚŒËºY◊è—VXç7dñ %`XÚŒËºY◊è—VXç7dñ˛ @Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.4036.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3733.cat|Microsoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat|rosoft-Windows-Client-Desktop-Required-Package0110~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat| %bc≥Ò$ì∞.æ∑\ã#Ç# %bc≥Ò$ì∞.æ∑\ã#Ç#˛ @Microsoft-Office-ClickToRun-57F8BBFF-CE63-4B94-B9EB-403DF995BC28-stream.x64.x-none.dat.cat|Microsoft-Office-ClickToRun-57F8BBFF-CE63-4B94-B9EB-403DF995BC28-stream.x64.x-none.dat.cat|Microsoft-Office-ClickToRun-57F8BBFF-CE63-4B94-B9EB-403DF995BC28-stream.x64.x-none.dat.cat|Package~31bf3856ad364e35~amd64~en-US~10.0.22621.1.cat|                               ˆ ∂&î ã%î ˜$ã --∑ú(ˆ $ó j#î ÷"Î Î!U|&Só R—'6#)ó   @ Í!ê Ï%jY+    Õ+πFtÕe	     82  H      ©⁄˙
 (  BÏ`-%$lã.DÌ•J JÃd BÏ`-%$lã.DÌ•J JÃd˛ @HyperV-UX-UI-62-merged-Package~31bf3856ad364e35~amd64~en-US~10.0.22621.1.cat| BÈë€©A3øÛÜ'$˚ãæ{u∏ BÈë€©A3øÛÜ'$˚ãæ{u∏˛ @Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.3672.cat|Microsoft-Windows-Client-Features-Package0010~31bf3856ad364e35~amd64~en-US~10.0.22621.3880.cat| BÍƒ_ô˘Ô@«ûwV∆ôiÀ≠ñ BÍƒ_ô˘Ô@«ûwV∆ôiÀ≠ñ˛