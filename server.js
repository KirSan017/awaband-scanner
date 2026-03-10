import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();

// Disable caching for development
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// Serve static files (dist/ for built JS, root for HTML/CSS/source modules)
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`AWABAND Scanner: http://localhost:${PORT}`);
});
