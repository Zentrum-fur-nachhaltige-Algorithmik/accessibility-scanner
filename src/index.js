const express = require('express');
const AccessibilityScanner = require('./scanner');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const scanner = new AccessibilityScanner();

app.post('/scan', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await scanner.scanWebpage(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Accessibility scanner server running on port ${port}`);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await scanner.close();
    process.exit(0);
  });
}

module.exports = { app, scanner };