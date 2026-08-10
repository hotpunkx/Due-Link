const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Installing app dependencies...');
execSync('npm install', { cwd: path.join(__dirname, 'app'), stdio: 'inherit' });

console.log('Building app...');
execSync('npm run build', { cwd: path.join(__dirname, 'app'), stdio: 'inherit' });

console.log('Copying build assets to dist...');
const distDir = path.join(__dirname, 'dist');
const distAppDir = path.join(distDir, 'app');

// Ensure directories exist
fs.mkdirSync(distAppDir, { recursive: true });

// Helper to copy directory recursively
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy app/dist to dist/app
const appDistDir = path.join(__dirname, 'app', 'dist');
if (fs.existsSync(appDistDir)) {
  copyDirSync(appDistDir, distAppDir);
}

// Copy root level files to dist
const rootFiles = ['index.html', 'logo.png', 'vercel.json'];
for (const file of rootFiles) {
  const srcPath = path.join(__dirname, file);
  const destPath = path.join(distDir, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} to dist/`);
  }
}

// Copy images to dist/images
const imagesDir = path.join(__dirname, 'images');
const distImagesDir = path.join(distDir, 'images');
if (fs.existsSync(imagesDir)) {
  copyDirSync(imagesDir, distImagesDir);
  console.log('Copied images directory to dist/images');
}

console.log('Build completed successfully!');
