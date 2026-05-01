<?php
// GET    /api/admin/api-keys
// POST   /api/admin/api-keys
// DELETE /api/admin/api-keys/{id}

function rowToApiKey(array $row): array {
    return [
        'id'          => $row['id'],
        'name'        => $row['name'],
        'agent_name'  => $row['agent_name'],
        'agent_email' => $row['agent_email'],
        'created_at'  => $row['created_at'],
        'last_used_at'=> $row['last_used_at'],
        'revoked'     => (bool)$row['revoked'],
    ];
}

$id = $params['id'] ?? null;

// GET /api/admin/api-keys
if ($method === 'GET') {
    requireRole(['admin']);
    $rows = sbSelect('api_keys', [], 'created_at.desc');
    echo json_encode(array_map('rowToApiKey', $rows));

// POST /api/admin/api-keys
} elseif ($method === 'POST') {
    requireRole(['admin']);

    $name       = $body['name'] ?? '';
    $agentName  = $body['agent_name'] ?? '';
    $agentEmail = $body['agent_email'] ?? '';

    if (!$name || !$agentName) {
        http_response_code(400);
        echo json_encode(['error' => 'Falten camps: name, agent_name']);
        return;
    }

    $rawKey = 'dbx_' . bin2hex(random_bytes(32));
    $hash   = hash('sha256', $rawKey);

    $row = sbInsert('api_keys', [
        'name'        => $name,
        'key_hash'    => $hash,
        'agent_name'  => $agentName,
        'agent_email' => $agentEmail,
    ]);

    if (!$row) {
        http_response_code(500);
        echo json_encode(['error' => 'Error creant la clau']);
        return;
    }

    http_response_code(201);
    echo json_encode(['key' => $rawKey, 'api_key' => rowToApiKey($row)]);

// DELETE /api/admin/api-keys/{id}
} elseif ($method === 'DELETE' && $id) {
    requireRole(['admin']);

    $row = sbSelectOne('api_keys', ['id' => 'eq.' . $id]);
    if (!$row) {
        http_response_code(404);
        echo json_encode(['error' => 'Clau no trobada']);
        return;
    }

    sbUpdate('api_keys', ['id' => 'eq.' . $id], ['revoked' => true]);
    echo json_encode(['success' => true]);

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
}
