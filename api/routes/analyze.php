<?php
// POST /api/analyze-instagram
// Proxy cap a post-to-json-api.vercel.app/api/analyze

requireRole(['admin']);

$imageBase64   = $body['imageBase64']   ?? null;
$imageMimeType = $body['imageMimeType'] ?? null;
$instagramUrl  = $body['instagramUrl']  ?? null;
$caption       = $body['caption']       ?? null;
$dryRun        = $body['dryRun']        ?? false;

if (!$imageBase64 && !$instagramUrl) {
    http_response_code(400);
    echo json_encode(['error' => 'Cal imageBase64 o instagramUrl']);
    return;
}

$payload = array_filter([
    'imageBase64'   => $imageBase64,
    'imageMimeType' => $imageMimeType,
    'instagramUrl'  => $instagramUrl,
    'caption'       => $caption,
    'dryRun'        => $dryRun ?: null,
], fn($v) => $v !== null && $v !== false);

$ch = curl_init('https://post-to-json-api.vercel.app/api/analyze');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_TIMEOUT        => 90,
]);
$response = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'No s\'ha pogut connectar amb l\'API d\'anàlisi']);
    return;
}

http_response_code($httpCode);
echo $response;
