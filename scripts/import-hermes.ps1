[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Ref
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$branch = git -C $repositoryRoot symbolic-ref --short HEAD
if ($LASTEXITCODE -ne 0 -or $branch -ne 'hermes-upstream') {
    throw 'Import upstream source only on the hermes-upstream branch.'
}
$changes = git -C $repositoryRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) {
    throw 'Commit or preserve existing changes before importing upstream source.'
}
$revision = git -C $repositoryRoot rev-parse --verify --end-of-options "$Ref^{commit}"
if ($LASTEXITCODE -ne 0) {
    throw "Cannot resolve upstream ref: $Ref. Fetch upstream first."
}
$revision = ($revision | Out-String).Trim()
$importRoot = Join-Path $repositoryRoot ('.state/hermes-import/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $importRoot -Force | Out-Null
$archivePath = Join-Path $importRoot 'upstream.tar'
git -C $repositoryRoot archive --format=tar "--output=$archivePath" $revision src LICENSE package.json
if ($LASTEXITCODE -ne 0) { throw 'Unable to archive upstream source.' }
tar -xf $archivePath -C $importRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract upstream source.' }

$package = [IO.File]::ReadAllText((Join-Path $importRoot 'package.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($package.name -ne 'pi-hermes-memory') { throw 'The ref does not contain the expected upstream package.' }
$vendorRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'vendor/hermes'))
$vendorSource = Join-Path $vendorRoot 'src'
$archiveSource = Join-Path $importRoot 'src'
$upstreamFiles = @(Get-ChildItem -LiteralPath $archiveSource -Recurse -File)
if ($upstreamFiles.Count -eq 0) { throw 'Upstream src is empty.' }
$relativeFiles = @($upstreamFiles | ForEach-Object { $_.FullName.Substring($archiveSource.Length + 1) })
$vendorPrefix = $vendorSource + [IO.Path]::DirectorySeparatorChar

if (Test-Path -LiteralPath $vendorSource) {
    foreach ($existing in Get-ChildItem -LiteralPath $vendorSource -Recurse -File) {
        $resolved = [IO.Path]::GetFullPath($existing.FullName)
        if (-not $resolved.StartsWith($vendorPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unexpected vendor path: $resolved"
        }
        $relative = $resolved.Substring($vendorPrefix.Length)
        if ($relativeFiles -notcontains $relative) { Remove-Item -LiteralPath $resolved }
    }
}

$utf8 = [Text.UTF8Encoding]::new($false)
$hasher = [Security.Cryptography.SHA256]::Create()
$manifest = @()
try {
    foreach ($relative in (@('LICENSE', 'package.json') + @($relativeFiles | ForEach-Object { 'src/' + $_.Replace('\', '/') }))) {
        $source = Join-Path $importRoot $relative
        $destination = [IO.Path]::GetFullPath((Join-Path $vendorRoot $relative))
        if (-not $destination.StartsWith($vendorRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unexpected import destination: $destination"
        }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
        # Git commits and the published source can use different line endings.
        if ([IO.Path]::GetExtension($source).ToLowerInvariant() -in @('.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.txt') -or $relative -eq 'LICENSE') {
            $content = [IO.File]::ReadAllText($source, [Text.Encoding]::UTF8).Replace("`r`n", "`n")
            $bytes = $utf8.GetBytes($content)
        } else {
            $bytes = [IO.File]::ReadAllBytes($source)
        }
        [IO.File]::WriteAllBytes($destination, $bytes)
        if ($relative.StartsWith('src/')) {
            $hash = [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
            $manifest += "$hash  $relative"
        }
    }
} finally {
    $hasher.Dispose()
}
[IO.File]::WriteAllLines((Join-Path $repositoryRoot 'UPSTREAM-FILES.sha256'), @($manifest | Sort-Object), $utf8)
$record = @"
# Hermes 上游基线

- 仓库：https://github.com/chandra447/pi-hermes-memory
- 引用：$Ref
- 提交：$revision
- 包版本：$($package.version)
- 导入范围：src/、LICENSE、package.json，映射到 vendor/hermes/。
- 文本编码：UTF-8，无 BOM，CRLF 统一为 LF。

hermes-upstream 仅保存未适配的上游 vendor 源码，供 master 三方合并使用，不用于加载插件。
UPSTREAM-FILES.sha256 记录该基线的 src/ 文件哈希，不是适配后源码的哈希。
更新流程见 UPSTREAM-UPDATE.md。本脚本不安装、编译、启动、测试、提交或推送。
"@
[IO.File]::WriteAllText((Join-Path $repositoryRoot 'UPSTREAM.md'), $record.Replace("`r`n", "`n") + "`n", $utf8)
Write-Output "Imported pi-hermes-memory $($package.version) at $revision. Review and commit the changes on hermes-upstream."
