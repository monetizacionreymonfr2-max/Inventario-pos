const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Allow large payloads (for 710+ products with base64 images)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Data directory
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos.json');
const VENTAS_FILE = path.join(DATA_DIR, 'ventas.json');
const FIADOS_FILE = path.join(DATA_DIR, 'fiados.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Helper to read JSON safely
function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
    return defaultValue;
  }
}

// Helper to write JSON safely
function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e);
    return false;
  }
}

// 1. Status & Health
app.get('/api/vps/status', (req, res) => {
  const productos = readJSON(PRODUCTOS_FILE, []);
  res.json({
    status: 'online',
    mode: 'autonomous_vps',
    totalProductos: productos.length,
    timestamp: new Date().toISOString()
  });
});

// 2. Migración Completa (1-Clic)
app.post('/api/vps/migracion-completa', (req, res) => {
  try {
    const { productos, config, fiados, ventas } = req.body;

    if (!productos || !Array.isArray(productos)) {
      return res.status(400).json({ error: 'Formato inválido. Se esperaba un array de productos.' });
    }

    // Save productos
    writeJSON(PRODUCTOS_FILE, productos);

    // Save config if provided
    if (config) {
      writeJSON(CONFIG_FILE, config);
    }

    // Save fiados if provided
    if (fiados && Array.isArray(fiados)) {
      writeJSON(FIADOS_FILE, fiados);
    }

    // Save ventas if provided
    if (ventas && Array.isArray(ventas)) {
      writeJSON(VENTAS_FILE, ventas);
    }

    // Also write a timestamped backup file
    const backupName = path.join(DATA_DIR, `backup_${Date.now()}.json`);
    writeJSON(backupName, { productos, config, fiados, ventas, fecha: new Date().toISOString() });

    console.log(`[MIGRACIÓN EXITOSA] ${productos.length} productos guardados en VPS.`);
    return res.json({
      success: true,
      mensaje: `Migración completada exitosamente en la VPS.`,
      totalProductos: productos.length
    });
  } catch (err) {
    console.error('Error en migración:', err);
    res.status(500).json({ error: err.message || 'Error guardando datos en VPS' });
  }
});

// 3. Productos Endpoints
app.get('/api/vps/productos', (req, res) => {
  const productos = readJSON(PRODUCTOS_FILE, []);
  res.json(productos);
});

app.post('/api/vps/productos', (req, res) => {
  try {
    const nuevo = req.body;
    if (!nuevo.nombre) {
      return res.status(400).json({ error: 'Nombre es requerido' });
    }

    const productos = readJSON(PRODUCTOS_FILE, []);
    const id = nuevo.id || `prod_${Date.now()}`;
    const item = { ...nuevo, id };

    const idx = productos.findIndex(p => p.id === id);
    if (idx >= 0) {
      productos[idx] = item;
    } else {
      productos.unshift(item);
    }

    writeJSON(PRODUCTOS_FILE, productos);
    res.json({ success: true, producto: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vps/productos/:id', (req, res) => {
  try {
    const { id } = req.params;
    let productos = readJSON(PRODUCTOS_FILE, []);
    productos = productos.filter(p => p.id !== id);
    writeJSON(PRODUCTOS_FILE, productos);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Ventas Endpoints
app.get('/api/vps/ventas', (req, res) => {
  const ventas = readJSON(VENTAS_FILE, []);
  res.json(ventas);
});

app.post('/api/vps/ventas', (req, res) => {
  try {
    const venta = req.body;
    const ventas = readJSON(VENTAS_FILE, []);
    const id = venta.id || `venta_${Date.now()}`;
    const nuevaVenta = { ...venta, id, fecha: venta.fecha || Date.now() };

    ventas.unshift(nuevaVenta);
    writeJSON(VENTAS_FILE, ventas);

    // Update stock in productos
    if (venta.items && Array.isArray(venta.items)) {
      const productos = readJSON(PRODUCTOS_FILE, []);
      venta.items.forEach(item => {
        const prod = productos.find(p => p.id === item.productoId);
        if (prod && typeof prod.stock === 'number') {
          prod.stock = Math.max(0, prod.stock - (Number(item.cantidad) || 0));
        }
      });
      writeJSON(PRODUCTOS_FILE, productos);
    }

    res.json({ success: true, venta: nuevaVenta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Fiados Endpoints
app.get('/api/vps/fiados', (req, res) => {
  const fiados = readJSON(FIADOS_FILE, []);
  res.json(fiados);
});

app.post('/api/vps/fiados', (req, res) => {
  try {
    const fiado = req.body;
    const fiados = readJSON(FIADOS_FILE, []);
    const id = fiado.id || `fiado_${Date.now()}`;
    const idx = fiados.findIndex(f => f.id === id);

    if (idx >= 0) {
      fiados[idx] = { ...fiados[idx], ...fiado };
    } else {
      fiados.unshift({ ...fiado, id, fecha: fiado.fecha || Date.now() });
    }

    writeJSON(FIADOS_FILE, fiados);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Configuración
app.get('/api/vps/config', (req, res) => {
  const config = readJSON(CONFIG_FILE, { tasa_dolar: 50 });
  res.json(config);
});

app.post('/api/vps/config', (req, res) => {
  try {
    const config = req.body;
    writeJSON(CONFIG_FILE, config);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BIBI STORE VPS BACKEND] Corriendo en http://0.0.0.0:${PORT}`);
});
