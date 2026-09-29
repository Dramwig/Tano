import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tauri writes Android icons into the generated project when it has been initialized.
// Keep the checked-in icon source directory in sync for future Android regeneration.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'client', 'src-tauri');
const generated = join(root, 'gen', 'android', 'app', 'src', 'main', 'res');
const source = join(root, 'icons', 'android');

if (!existsSync(generated)) {
  console.log('Android project is not initialized; Tauri generated icons in the icon source directory.');
  process.exit(0);
}

for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const relative = join(`mipmap-${density}`, name);
    const destination = join(source, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(generated, relative), destination);
  }
}

for (const relative of [
  join('mipmap-anydpi-v26', 'ic_launcher.xml'),
  join('values', 'ic_launcher_background.xml'),
]) {
  const destination = join(source, relative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(generated, relative), destination);
}
