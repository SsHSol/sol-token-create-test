const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(__dirname, 'src');

async function build() {
  console.log('🔨 Building token creation site...');

  // 1. 构建主 JS bundle（打包所有依赖，包括 spl-token / spl-token-metadata）
  console.log('  📦 Bundling app.js (including all deps)...');
  const result = await esbuild.build({
    entryPoints: [path.join(SRC, 'app.js')],
    bundle: true,
    outfile: path.join(ROOT, 'bundle.js'),
    minify: true,
    format: 'iife',
    globalName: 'TokenApp',
    define: {
      'global': 'globalThis',
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: '// SolFabi Token Creator - Built at ' + new Date().toISOString(),
    },
  });
  if (result.errors.length > 0) {
    console.error('❌ Build errors:');
    result.errors.forEach(e => console.error('  ', e));
    process.exit(1);
  }
  if (result.warnings.length > 0) {
    result.warnings.forEach(w => console.warn('  ⚠️', w));
  }

  // 2. 读取生成的 bundle
  const bundleContent = fs.readFileSync(path.join(ROOT, 'bundle.js'), 'utf8');
  const bundleSizeKB = (bundleContent.length / 1024).toFixed(1);
  console.log(`  📏 Bundle size: ${bundleSizeKB} KB`);

  // 3. 读取 HTML 模板并写入
  console.log('  📄 Copying index.html...');
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  html = html.replace(/__BUILD_TIME__/g, new Date().toISOString());
  html = html.replace(/__BUNDLE_SIZE__/g, bundleSizeKB);
  fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');

  console.log('✅ Build complete!');
  console.log(`   Output: ${path.join(ROOT, 'index.html')}`);
  console.log(`   Bundle: ${path.join(ROOT, 'bundle.js')} (${bundleSizeKB} KB)`);
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
