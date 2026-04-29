<?php
// POST  /api/requests
// GET   /api/requests
// GET   /api/requests/{id}
// PUT   /api/admin/requests/{id}/approve
// PUT   /api/admin/requests/{id}/reject

$STATUS = [
    'pending'  => 'https://schema.org/PotentialActionStatus',
    'approved' => 'https://schema.org/CompletedActionStatus',
    'rejected' => 'https://schema.org/FailedActionStatus',
];

$CONTENT_FILES = [
    'artist' => DATA_DIR . '/artists.json',
    'event'  => DATA_DIR . '/events.json',
    'news'   => DATA_DIR . '/news.json',
];

function rowToRequest(array $row, array $STATUS): array {
    return [
        '@type'        => $row['type'],
        '@id'          => $row['id'],
        'agent'        => [
            '@type' => 'Person',
            '@id'   => $row['agent_id'],
            'name'  => $row['agent_name'],
            'email' => $row['agent_email'],
        ],
        'actionStatus' => $STATUS[$row['status']] ?? '',
        'object'       => $row['current_data'] ? json_decode($row['current_data'], true) : ['@type' => 'Thing'],
        'result'       => $row['proposed_data'] ? json_decode($row['proposed_data'], true) : null,
        'description'  => $row['description'],
        'startTime'    => $row['created_at'],
        'endTime'      => $row['resolved_at'],
        'instrument'   => array_filter([
            '@type'       => 'Thing',
            'name'        => 'entityType',
            'description' => $row['entity_type'],
            'additionalProperty' => $row['reviewer_notes'] ? [[
                '@type' => 'PropertyValue', 'name' => 'reviewerNotes', 'value' => $row['reviewer_notes']
            ]] : null,
        ]),
    ];
}

$id     = $params['id'] ?? null;
$action = $params['action'] ?? null; // 'approve' | 'reject'

// PUT /api/admin/requests/{id}/approve
if ($method === 'PUT' && $id && $action === 'approve') {
    requireRole(['admin']);
    $row = sbSelectOne('requests', ['id' => 'eq.' . $id]);
    if (!$row) { http_response_code(404); echo json_encode(['error' => 'Solicitud no trobada']); return; }
    if ($row['status'] !== 'pending') { http_response_code(400); echo json_encode(['error' => 'Aquesta solicitud ja ha estat processada']); return; }

    sbUpdate('requests', ['id' => 'eq.' . $id], ['status' => 'approved', 'resolved_at' => date('c')]);
    echo json_encode(['success' => true, 'message' => 'Solicitud aprovada']);

// PUT /api/admin/requests/{id}/reject
} elseif ($method === 'PUT' && $id && $action === 'reject') {
    requireRole(['admin']);
    $row = sbSelectOne('requests', ['id' => 'eq.' . $id]);
    if (!$row) { http_response_code(404); echo json_encode(['error' => 'Solicitud no trobada']); return; }
    if ($row['status'] !== 'pending') { http_response_code(400); echo json_encode(['error' => 'Ja processada']); return; }

    $notes = $body['notes'] ?? null;
    sbUpdate('requests', ['id' => 'eq.' . $id], ['status' => 'rejected', 'reviewer_notes' => $notes, 'resolved_at' => date('c')]);
    echo json_encode(['success' => true, 'message' => 'Solicitud rebutjada']);

// GET /api/requests/{id}
} elseif ($method === 'GET' && $id) {
    $userRow = requireRole(['promotor', 'admin']);
    $row = sbSelectOne('requests', ['id' => 'eq.' . $id]);
    if (!$row) { http_response_code(404); echo json_encode(['error' => 'Solicitud no trobada']); return; }
    if ($userRow['role'] === 'promotor' && $row['agent_id'] !== $userRow['id']) {
        http_response_code(403); echo json_encode(['error' => 'No autoritzat']); return;
    }
    echo json_encode(['request' => rowToRequest($row, $STATUS)]);

// GET /api/requests
} elseif ($method === 'GET') {
    $userRow = requireRole(['promotor', 'admin']);
    $isAdmin = $userRow['role'] === 'admin';

    $filters = ['order' => 'created_at.desc'];
    if (!$isAdmin) $filters['agent_id'] = 'eq.' . $userRow['id'];
    $statusFilter = $_GET['status'] ?? null;
    if ($statusFilter && isset($STATUS[$statusFilter])) $filters['status'] = 'eq.' . $statusFilter;

    $rows  = sbSelect('requests', $filters);
    $items = array_map(fn($r, $i) => ['@type' => 'ListItem', 'position' => $i + 1, 'item' => rowToRequest($r, $STATUS)], $rows, array_keys($rows));
    echo json_encode([
        '@context'        => 'https://schema.org',
        '@type'           => 'ItemList',
        'numberOfItems'   => count($rows),
        'itemListElement' => $items,
    ]);

// POST /api/requests
} elseif ($method === 'POST') {
    $userRow    = requireRole(['promotor', 'admin']);
    $entityType = $body['entityType'] ?? '';
    $entityId   = $body['entityId'] ?? null;
    $action2    = $body['action'] ?? '';
    $proposed   = $body['proposedData'] ?? null;
    $desc       = $body['description'] ?? null;

    if (!in_array($entityType, ['artist', 'event', 'news'])) {
        http_response_code(400); echo json_encode(['error' => 'entityType invàlid (artist, event, news)']); return;
    }
    if (!in_array($action2, ['create', 'update'])) {
        http_response_code(400); echo json_encode(['error' => 'action invàlida (create, update)']); return;
    }
    if (!$proposed || !$desc) {
        http_response_code(400); echo json_encode(['error' => 'Falten camps obligatoris: proposedData, description']); return;
    }

    $currentObj = null;
    if ($action2 === 'update' && $entityId) {
        $contentData = readJSON($CONTENT_FILES[$entityType]);
        $found = null;
        foreach ($contentData['itemListElement'] as $el) {
            if (($el['item']['@id'] ?? null) === $entityId) { $found = $el['item']; break; }
        }
        if (!$found) { http_response_code(404); echo json_encode(['error' => 'Entitat no trobada']); return; }
        $currentObj = $found;
    }

    $newRow = sbInsert('requests', [
        'type'          => $action2 === 'create' ? 'CreateAction' : 'UpdateAction',
        'agent_id'      => $userRow['id'],
        'agent_name'    => $userRow['name'],
        'agent_email'   => $userRow['email'],
        'entity_type'   => $entityType,
        'entity_id'     => $entityId,
        'current_data'  => $currentObj ? json_encode($currentObj) : null,
        'proposed_data' => json_encode($proposed),
        'description'   => $desc,
    ]);

    if (!$newRow) { http_response_code(500); echo json_encode(['error' => 'Error creant la solicitud']); return; }

    http_response_code(201);
    echo json_encode(['success' => true, 'request' => rowToRequest($newRow, $STATUS)]);

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
}
