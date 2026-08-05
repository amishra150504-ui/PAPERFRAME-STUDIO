import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pngToIco from 'png-to-ico';

await mkdir('build', { recursive: true });
const source = await readFile('public/assets/paperframe-logo-source.png');
const icon = await pngToIco(source);
await writeFile('build/paperframe.ico', icon);
console.log('Windows icon created at build/paperframe.ico');
