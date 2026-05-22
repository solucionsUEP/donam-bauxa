<?php
/**
 * GET /version.json
 *
 * Exposes the app + data versions used by the service worker to decide when
 * to invalidate caches. Must never be cached by any intermediary.
 *
 *   { app:  "<git short SHA, or 'prod' fallback>",
 *     data: "<ISO timestamp of newest file under DATA_DIR>" }
 */

// Override the JSON Cache-Control header set by index.php to be even stricter.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

$appVersion = 'prod';
$headFile   = dirname(__DIR__, 2) . '/.git/HEAD';
if (is_readable($headFile)) {
    $head = trim((string)file_get_contents($headFile));
    if (strpos($head, 'ref: ') === 0) {
        $refPath = dirname(__DIR__, 2) . '/.git/' . substr($head, 5);
        if (is_readable($refPath)) {
            $sha = trim((string)file_get_contents($refPath));
            if ($sha !== '') $appVersion = substr($sha, 0, 7);
        }
    } elseif (preg_match('/^[0-9a-f]{7,40}$/', $head)) {
        $appVersion = substr($head, 0, 7);
    }
}

$newest = 0;
if (defined('DATA_DIR') && is_dir(DATA_DIR)) {
    foreach (glob(DATA_DIR . '/*.json') ?: [] as $f) {
        $m = @filemtime($f);
        if ($m !== false && $m > $newest) $newest = $m;
    }
}
if ($newest === 0) $newest = time();

echo json_encode([
    'app'  => $appVersion,
    'data' => gmdate('Y-m-d\TH:i:s\Z', $newest),
]);
