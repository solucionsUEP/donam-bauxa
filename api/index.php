<?php
ini_set('display_errors', 0);
error_reporting(E_ALL);

set_exception_handler(function (Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => 'Error intern del servidor', 'detail' => $e->getMessage()]);
    exit;
});

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/helpers/supabase.php';
require_once __DIR__ . '/helpers/auth.php';
require_once __DIR__ . '/helpers/json.php';

// Apache pot eliminar Authorization — el recuperem de l'env var que posa el .htaccess
if (empty($_SERVER['HTTP_AUTHORIZATION']) && !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
}

// CORS
$allowedOrigins = ['https://donambauxa.online', 'https://www.donambauxa.online', 'http://localhost:3000'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri    = rtrim($uri, '/');

$body = [];
if (in_array($method, ['POST', 'PUT', 'PATCH'])) {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true) ?? [];
}

// --- Router ---

// GET /version.json (PWA freshness check — never cached)
if ($uri === '/version.json' && $method === 'GET') {
    require __DIR__ . '/routes/version.php';

// GET /auth/me
} elseif ($uri === '/auth/me' && $method === 'GET') {
    require __DIR__ . '/routes/auth.php';

// GET /api/chat/health  |  POST /api/chat
} elseif ($uri === '/api/chat/health' || $uri === '/api/chat') {
    require __DIR__ . '/routes/chat.php';

// Web Push: GET /api/push/vapid | POST /api/push/subscribe | POST /api/push/unsubscribe
} elseif ($uri === '/api/push/vapid' || $uri === '/api/push/subscribe' || $uri === '/api/push/unsubscribe') {
    require __DIR__ . '/routes/push.php';

// GET|PUT /api/profile
} elseif ($uri === '/api/profile') {
    require __DIR__ . '/routes/profile.php';

// /api/admin/users
} elseif (preg_match('#^/api/admin/users(/([^/]+)(/role)?)?$#', $uri, $m)) {
    $params = [
        'id'     => $m[2] ?? null,
        'action' => isset($m[3]) ? 'role' : null,
    ];
    require __DIR__ . '/routes/users.php';

// GET /api/admin/requests  (admin: veure totes les solicituds)
} elseif ($uri === '/api/admin/requests' && $method === 'GET') {
    $params = ['id' => null, 'adminList' => true];
    require __DIR__ . '/routes/requests.php';

// PUT /api/admin/requests/{id}/approve|reject
} elseif (preg_match('#^/api/admin/requests/([^/]+)/(approve|reject)$#', $uri, $m)) {
    $params = ['id' => $m[1], 'action' => $m[2]];
    require __DIR__ . '/routes/requests.php';

// GET|POST /api/requests  or  GET /api/requests/{id}
} elseif (preg_match('#^/api/requests(/([^/]+))?$#', $uri, $m)) {
    $params = ['id' => $m[2] ?? null];
    require __DIR__ . '/routes/requests.php';

// POST /api/analyze-instagram
} elseif ($uri === '/api/analyze-instagram' && $method === 'POST') {
    require __DIR__ . '/routes/analyze.php';

// GET /api/admin/api-keys  |  POST /api/admin/api-keys  |  DELETE /api/admin/api-keys/{id}
} elseif (preg_match('#^/api/admin/api-keys(/([^/]+))?$#', $uri, $m)) {
    $params = ['id' => $m[2] ?? null];
    require __DIR__ . '/routes/api_keys.php';

// CRUD /api/admin/{artists|events|news|questionnaires|questions}[/{id}[/archive]]
} elseif (preg_match('#^/api/admin/(artists|events|news|questionnaires|questions)(/([^/]+)(/archive)?)?$#', $uri, $m)) {
    $params = [
        'entityType' => $m[1],
        'id'         => $m[3] ?? null,
        'archive'    => isset($m[4]) && $m[4] === '/archive',
    ];
    require __DIR__ . '/routes/content.php';

} else {
    http_response_code(404);
    echo json_encode(['error' => 'Ruta no trobada']);
}
