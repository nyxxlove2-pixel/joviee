<?php

namespace App\Controllers;

use App\Models\UserModel;
use App\Models\ProfilingModel;
use CodeIgniter\Controller;
use App\Models\LogModel;

class Profiling extends Controller
{
    public function index(){
        $model = new ProfilingModel();
        $data['profiling'] = $model->findAll();
        return view('profiling/index', $data);
    }

    public function save(){
        $name = $this->request->getPost('name');
        $bday = $this->request->getPost('bday');
        $address = $this->request->getPost('address');

        $userModel = new \App\Models\ProfilingModel();
        $logModel = new LogModel();

        $data = [
            'name'       => $name,
            'bday'       => $bday,
            'address'    => $address
        ];

        if ($userModel->insert($data)) {
            $logModel->addLog('New Profiling has been added: ' . $name, 'ADD');
            return $this->response->setJSON(['status' => 'success']);
        } else {
            return $this->response->setJSON(['status' => 'error', 'message' => 'Failed to save Profiling']);
        }
    }

    public function update(){
        $model = new ProfilingModel();
        $logModel = new LogModel();
        $userId = $this->request->getPost('id');
        $name = $this->request->getPost('name');
        $bday = $this->request->getPost('bday');
        $address = $this->request->getPost('address');

        $userData = [
            'name'       => $name,
            'bday'       => $bday,
            'address'    => $address
        ];

        $updated = $model->update($userId, $userData);

        if ($updated) {
            $logModel->addLog('New Profiling has been apdated: ' . $name, 'UPDATED');
            return $this->response->setJSON([
                'success' => true,
                'message' => 'Profiling updated successfully.'
            ]);
        } else {
            return $this->response->setJSON([
                'success' => false,
                'message' => 'Error updating Profiling.'
            ]);
        }
    }

    public function edit($id){
        $model = new ProfilingModel();
    $user = $model->find($id); // Fetch user by ID

    if ($user) {
        return $this->response->setJSON(['data' => $user]); // Return user data as JSON
    } else {
        return $this->response->setStatusCode(404)->setJSON(['error' => 'User not found']);
    }
}

public function delete($id){
    $model = new ProfilingModel();
    $logModel = new LogModel();
    $user = $model->find($id);
    if (!$user) {
        return $this->response->setJSON(['success' => false, 'message' => 'Profiling not found.']);
    }

    $deleted = $model->delete($id);

    if ($deleted) {
        $logModel->addLog('Delete Profiling', 'DELETED');
        return $this->response->setJSON(['success' => true, 'message' => 'Profiling deleted successfully.']);
    } else {
        return $this->response->setJSON(['success' => false, 'message' => 'Failed to delete Profiling.']);
    }
}

public function fetchRecords()
{
    $request = service('request');
    $model = new \App\Models\ProfilingModel();

    $start = $request->getPost('start') ?? 0;
    $length = $request->getPost('length') ?? 10;
    $searchValue = $request->getPost('search')['value'] ?? '';

    $totalRecords = $model->countAll();
    $result = $model->getRecords($start, $length, $searchValue);

    $data = [];
    $counter = $start + 1;
    foreach ($result['data'] as $row) {
        $row['row_number'] = $counter++;
        $data[] = $row;
    }

    return $this->response->setJSON([
        'draw' => intval($request->getPost('draw')),
        'recordsTotal' => $totalRecords,
        'recordsFiltered' => $result['filtered'],
        'data' => $data,
    ]);
}

}