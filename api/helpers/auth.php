<?php
function base64url_decode(string $data): string {
    $pad = strlen($data) % 4;
    if ($pad) $data .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($data, '-_', '+/'));
}

function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function verifyJWT(string $token): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;

    [$header, $payload, $sig] = $parts;
    $expected = base64url_encode(hash_hmac('sha256', "$header.$payload", SUPABASE_JWT_SECRET, true));
    if (!hash_equals($expected, $sig)) return null;

    $data = json_decode(base64url_decode($payload), true);
    if (!$data) return null;
    if (isset($data['exp']) && $data['exp'] < time()) return null;

    return $data;
}

function getTokenPayload(): ?array {
    $headers = getallheaders();
    $auth = $headers['Authorization']
        ?? $headers['authorization']
        ?? $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if (!str_starts_with($auth, 'Bearer ')) return null;
    return verifyJWT(substr($auth, 7));
}

function getAuthUserRow(): ?array {
    $payload = getTokenPayload();
    if (!$payload || empty($payload['sub'])) return null;
    return sbSelectOne('users', ['id' => 'eq.' . $payload['sub']]);
}

function requireAuth(): array {
    $row = getAuthUserRow();
    if (!$row) {
        http_response_code(401);
        echo json_encode(['error' => 'No autenticat']);
        exit;
    }
    return $row;
}

function requireRole(array $roles): array {
    $row = getAuthUserRow();
    if (!$row || !in_array($row['role'], $roles)) {
        http_response_code(403);
        echo json_encode(['error' => 'No autoritzat']);
        exit;
    }
    return $row;
}
