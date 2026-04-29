<?php
// GET /api/admin/users
// PUT /api/admin/users/{id}/role
// DELETE /api/admin/users/{id}

$id     = $params['id'] ?? null;
$action = $params['action'] ?? null; // 'role'

if ($method === 'GET' && !$id) {
    requireRole(['admin']);
    $rows = sbSelect('users', [], 'created_at');
    $items = array_map(fn($u, $i) => ['@type' => 'ListItem', 'position' => $i + 1, 'item' => rowToProfile($u)], $rows, array_keys($rows));
    echo json_encode([
        '@context'        => 'https://schema.org',
        '@type'           => 'ItemList',
        'name'            => 'Usuaris registrats',
        'numberOfItems'   => count($rows),
        'itemListElement' => $items,
    ]);

} elseif ($method === 'PUT' && $id && $action === 'role') {
    $adminRow = requireRole(['admin']);
    $role = $body['role'] ?? '';
    $valid = ['lector', 'promotor', 'admin'];
    if (!in_array($role, $valid)) {
        http_response_code(400);
        echo json_encode(['error' => 'Rol invàlid. Rols vàlids: ' . implode(', ', $valid)]);
        return;
    }
    $updated = sbUpdate('users', ['id' => 'eq.' . $id], ['role' => $role]);
    if (!$updated) { http_response_code(404); echo json_encode(['error' => 'Usuari no trobat']); return; }
    echo json_encode(['success' => true, 'user' => rowToProfile($updated)]);

} elseif ($method === 'DELETE' && $id) {
    $adminRow = requireRole(['admin']);
    if ($adminRow['id'] === $id) {
        http_response_code(400);
        echo json_encode(['error' => 'No pots eliminar-te a tu mateix']);
        return;
    }
    $ok = sbDelete('users', ['id' => 'eq.' . $id]);
    if (!$ok) { http_response_code(404); echo json_encode(['error' => 'Usuari no trobat']); return; }
    echo json_encode(['success' => true]);

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
}
