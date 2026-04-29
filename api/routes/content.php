<?php
// CRUD genèric per a: artists, events, news, questionnaires, questions
// $params['entityType'], $params['id'], $params['archive']

$PREFIXES = [
    'artists'        => 'artist',
    'events'         => 'event',
    'news'           => 'news',
    'questionnaires' => 'quiz',
    'questions'      => 'question',
];

$entityType = $params['entityType'];
$id         = $params['id'] ?? null;
$isArchive  = $params['archive'] ?? false;
$prefix     = $PREFIXES[$entityType];
$filePath   = DATA_DIR . '/' . $entityType . '.json';

// PUT /{type}/{id}/archive
if ($method === 'PUT' && $id && $isArchive) {
    requireRole(['admin']);
    $archived = $body['archived'] ?? false;

    $updatedItem = writeJSONSafe($filePath, function (&$data) use ($id, $archived) {
        foreach ($data['itemListElement'] as &$el) {
            if (($el['item']['@id'] ?? null) !== $id) continue;

            if (!isset($el['item']['additionalProperty'])) $el['item']['additionalProperty'] = [];
            $found = false;
            foreach ($el['item']['additionalProperty'] as &$prop) {
                if ($prop['name'] === 'archived') { $prop['value'] = (bool)$archived; $found = true; break; }
            }
            if (!$found) {
                $el['item']['additionalProperty'][] = ['@type' => 'PropertyValue', 'name' => 'archived', 'value' => (bool)$archived];
            }
            return $el['item'];
        }
        return null;
    });

    if (!$updatedItem) { http_response_code(404); echo json_encode(['error' => 'Element no trobat']); return; }
    echo json_encode(['success' => true, 'item' => $updatedItem]);

// GET /{type}
} elseif ($method === 'GET' && !$id) {
    requireRole(['admin']);
    echo json_encode(readJSON($filePath));

// POST /{type}
} elseif ($method === 'POST' && !$id) {
    requireRole(['admin']);
    $item = $body;
    if (empty($item['name']) && empty($item['headline'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Falta el camp obligatori: name o headline']);
        return;
    }

    $newItem = writeJSONSafe($filePath, function (&$data) use ($item, $prefix) {
        ['id' => $newId, 'position' => $pos] = generateId($prefix, $data['itemListElement']);
        $item['@id'] = $newId;
        $data['itemListElement'][] = ['@type' => 'ListItem', 'position' => $pos, 'item' => $item];
        $data['numberOfItems'] = count($data['itemListElement']);
        return $item;
    });

    http_response_code(201);
    echo json_encode(['success' => true, 'item' => $newItem]);

// PUT /{type}/{id}
} elseif ($method === 'PUT' && $id) {
    requireRole(['admin']);
    $updates = $body;

    $updatedItem = writeJSONSafe($filePath, function (&$data) use ($id, $updates) {
        foreach ($data['itemListElement'] as &$el) {
            if (($el['item']['@id'] ?? null) !== $id) continue;
            foreach ($updates as $k => $v) $el['item'][$k] = $v;
            return $el['item'];
        }
        return null;
    });

    if (!$updatedItem) { http_response_code(404); echo json_encode(['error' => 'Element no trobat']); return; }
    echo json_encode(['success' => true, 'item' => $updatedItem]);

// DELETE /{type}/{id}
} elseif ($method === 'DELETE' && $id) {
    requireRole(['admin']);

    $found = writeJSONSafe($filePath, function (&$data) use ($id) {
        foreach ($data['itemListElement'] as $i => $el) {
            if (($el['item']['@id'] ?? null) !== $id) continue;
            array_splice($data['itemListElement'], $i, 1);
            $data['numberOfItems'] = count($data['itemListElement']);
            foreach ($data['itemListElement'] as $j => &$e) $e['position'] = $j + 1;
            return true;
        }
        return false;
    });

    if (!$found) { http_response_code(404); echo json_encode(['error' => 'Element no trobat']); return; }
    echo json_encode(['success' => true]);

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
}
