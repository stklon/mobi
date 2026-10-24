# 尝试 DPAPI 解密 ZCode 存储的 OAuth token（仅打印前缀验证格式，不输出完整值）
Add-Type -AssemblyName System.Security

$raw = (Get-Content 'C:\Users\Administrator\.zcode\v2\credentials.json' -Raw | ConvertFrom-Json).'oauth:zai:access_token'
if (-not $raw.StartsWith('enc:v1:')) { Write-Host "unexpected format: $($raw.Substring(0, 12))"; exit 0 }
$b64 = $raw.Substring(7)
$bytes = [Convert]::FromBase64String($b64)
Write-Host "encrypted payload: $($bytes.Length) bytes, prefix: $($bytes[0..3] -join ',')"

foreach ($entropyName in @('none', 'empty')) {
    $entropy = if ($entropyName -eq 'empty') { [byte[]]@() } else { $null }
    try {
        $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $text = [Text.Encoding]::UTF8.GetString($dec)
        Write-Host "[$entropyName] DECRYPTED: length=$($text.Length), prefix=$($text.Substring(0, [Math]::Min(16, $text.Length)))"
    } catch {
        Write-Host "[$entropyName] fail: $($_.Exception.Message)"
    }
}
