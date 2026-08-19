import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import pngToIco from 'png-to-ico';

await mkdir('build', { recursive: true });
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const source = 'public/assets/paperframe-logo-transparent.png';
const resizeScript = `Add-Type -AssemblyName System.Drawing; $source=[System.Drawing.Image]::FromFile('${source.replaceAll('/', '\\')}'); foreach($size in @(${sizes.join(',')})){ $bitmap=New-Object System.Drawing.Bitmap($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb); $graphics=[System.Drawing.Graphics]::FromImage($bitmap); $graphics.Clear([System.Drawing.Color]::Transparent); $graphics.CompositingQuality=[System.Drawing.Drawing2D.CompositingQuality]::HighQuality; $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality; $pad=[Math]::Max(0,[Math]::Round($size*.02)); $edge=$size-2*$pad; $graphics.DrawImage($source,(New-Object System.Drawing.Rectangle($pad,$pad,$edge,$edge))); $bitmap.Save("build\\icon-$size.png",[System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose() }; $source.Dispose()`;
execFileSync('powershell.exe', ['-NoProfile', '-Command', resizeScript]);
const icon = await pngToIco(await Promise.all(sizes.map(size => readFile(`build/icon-${size}.png`))));
await writeFile('build/paperframe.ico', icon);
console.log(`Windows multi-resolution icon created at build/paperframe.ico (${sizes.join(', ')} px)`);
