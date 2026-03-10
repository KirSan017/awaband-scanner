import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();

// Serve static files (dist/ for built JS, root for HTML/CSS/source modules)
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`AWABAND Scanner: http://localhost:${PORT}`);
});
