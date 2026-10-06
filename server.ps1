$port = 3000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Cockpit Low Ticket Master rodando em http://localhost:$port/"

$root = $PSScriptRoot

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath.TrimStart('/')
        
        if ($urlPath -eq "log_error") {
            $msg = $request.Url.Query
            [System.IO.File]::AppendAllText((Join-Path $root "browser_errors.log"), "$msg`r`n")
            $response.StatusCode = 200
            $response.OutputStream.Close()
            continue
        }

        if ($urlPath -eq "api/status") {
            $json = '{"ok":true,"dbConnected":false,"driver":"postgresql","message":"Ambiente de desenvolvimento local (Porta 3000)"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
            continue
        }

        if ($urlPath -eq "api/projects" -or $urlPath -eq "api/state") {
            $json = '{"ok":true,"source":"local_ps","projects":[]}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
            continue
        }

        # Redireciona a raiz para o aplicativo principal
        if ([string]::IsNullOrEmpty($urlPath)) {
            $urlPath = "index.html"
        } elseif ($urlPath -eq "app" -or $urlPath -eq "app/") {
            $urlPath = "index.html"
        } elseif ($urlPath -eq "pagina-vendas" -or $urlPath -eq "pagina-vendas/") {
            $urlPath = "pagina-vendas/index.html"
        }

        $filePath = Join-Path $root $urlPath

        # Se não encontrar na raiz, procura dentro de app/
        if (-not (Test-Path $filePath -PathType Leaf)) {
            $altPath = Join-Path (Join-Path $root "app") $urlPath
            if (Test-Path $altPath -PathType Leaf) {
                $filePath = $altPath
            }
        }

        # Se for diretório, procura index.html
        if (Test-Path $filePath -PathType Container) {
            $filePath = Join-Path $filePath "index.html"
        }

        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".svg"  { $response.ContentType = "image/svg+xml" }
                default { $response.ContentType = "application/octet-stream" }
            }
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Nao Encontrado: $urlPath")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $response.OutputStream.Close()
    } catch {
        # Tratamento de interrupcoes normais
    }
}
