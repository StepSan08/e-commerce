require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const serviceAccount = require('./firebase-key.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Conexión Supabase (SQL)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Conexión Firebase Firestore (NoSQL)
initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore();

// 1. READ HÍBRIDO (GET): Une productos de Supabase + fichas y reseñas de Firestore
app.get('/api/productos', async (req, res) => {
  try {
    const { data: productosSQL, error } = await supabase.from('productos').select('*');
    if (error) throw error;

    const resultado = await Promise.all(productosSQL.map(async (prod) => {
      const fichaDoc = await db.collection('fichas_productos').doc(prod.producto_id).get();
      const resenaDoc = await db.collection('resenas_productos').doc(prod.producto_id).get();
      return {
        ...prod,
        ficha: fichaDoc.exists ? fichaDoc.data() : { descripcion: '', fotos: [], detalles: {} },
        comentarios: resenaDoc.exists ? resenaDoc.data().comentarios : []
      };
    }));

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. CREATE HÍBRIDO (POST): Guarda en Supabase y en Firestore usando producto_id
app.post('/api/productos', async (req, res) => {
  const { producto_id, nombre, precio, stock, descripcion, foto, color, garantia } = req.body;
  try {
    const { error: sqlError } = await supabase
      .from('productos')
      .insert([{ producto_id, nombre, precio: Number(precio), stock: Number(stock) }]);
    if (sqlError) throw sqlError;

    await db.collection('fichas_productos').doc(producto_id).set({
      producto_id,
      descripcion,
      fotos: foto ? [foto] : [],
      detalles: { color, garantia }
    });

    await db.collection('resenas_productos').doc(producto_id).set({
      producto_id,
      comentarios: []
    });

    res.json({ mensaje: 'Producto creado en Supabase y Firestore' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. UPDATE HÍBRIDO (PUT): Actualiza precio/stock en SQL y descripción en NoSQL
app.put('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { precio, stock, descripcion } = req.body;
  try {
    const { error: sqlError } = await supabase
      .from('productos')
      .update({ precio: Number(precio), stock: Number(stock) })
      .eq('producto_id', id);
    if (sqlError) throw sqlError;

    await db.collection('fichas_productos').doc(id).update({ descripcion });

    res.json({ mensaje: 'Producto actualizado en ambas bases' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. DELETE HÍBRIDO (DELETE): Elimina en Supabase y en Firestore
app.delete('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error: sqlError } = await supabase.from('productos').delete().eq('producto_id', id);
    if (sqlError) throw sqlError;

    await db.collection('fichas_productos').doc(id).delete();
    await db.collection('resenas_productos').doc(id).delete();

    res.json({ mensaje: 'Producto eliminado de Supabase y Firestore' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comprar producto (Descuenta stock en SQL y crea venta + detalle_venta)
app.post('/api/comprar', async (req, res) => {
  const { producto_id, usuario_id } = req.body;
  try {
    const { data: prod } = await supabase.from('productos').select('*').eq('producto_id', producto_id).single();
    if (!prod || prod.stock <= 0) return res.status(400).json({ error: 'Sin stock disponible' });

    const venta_id = 'V-' + Date.now();
    await supabase.from('ventas').insert([{ venta_id, usuario_id, total: prod.precio }]);
    await supabase.from('detalle_venta').insert([{ venta_id, producto_id, cantidad: 1, subtotal: prod.precio }]);
    await supabase.from('productos').update({ stock: prod.stock - 1 }).eq('producto_id', producto_id);

    res.json({ mensaje: 'Compra registrada en Supabase' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agregar reseña en Firestore (arreglo anidado)
app.post('/api/resenas/:id', async (req, res) => {
  const { id } = req.params;
  const { cliente, calificacion, texto } = req.body;
  try {
    await db.collection('resenas_productos').doc(id).update({
      comentarios: FieldValue.arrayUnion({
        cliente,
        calificacion: Number(calificacion),
        texto
      })
    });
    res.json({ mensaje: 'Reseña agregada en Firestore' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});