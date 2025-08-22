require("dotenv").config();
const express = require("express");
const mysql = require('mysql2/promise'); // Usa mysql2/promise para async/await
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://sermex-frontend.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.options('*', cors());

// Conexión a MySQL
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Configuración Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Middleware para autenticar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || "secreto", (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// 🔐 Ruta de Login
app.post("/login", async (req, res) => {
  const { correo, password } = req.body;
  console.log("[LOGIN] Intento de acceso para:", correo);

  try {
    const [results] = await db.query("SELECT * FROM usuarios WHERE correo = ?", [correo]);
    if (results.length === 0) {
      console.warn("[LOGIN] Usuario no encontrado:", correo);
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("[LOGIN] Contraseña incorrecta para:", correo);
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign({ id: user.id, correo: user.correo }, process.env.JWT_SECRET || "secreto", { expiresIn: "1h" });

    console.log("[LOGIN] Usuario autenticado correctamente:", correo);

    res.json({ 
      mensaje: "Inicio de sesión exitoso", 
      token,
      user: {
        id: user.id,
        correo: user.correo
      }
    });
  } catch (err) {
    console.error("[LOGIN] Error en el servidor:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// 🔏 Ruta para Registrar Usuario
app.post("/register", async (req, res) => {
  const { correo, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO usuarios (correo, password) VALUES (?, ?)", [correo, hash]);
    res.json({ mensaje: "Usuario registrado correctamente" });
  } catch (err) {
    console.error("[REGISTER] Error al registrar usuario:", err);
    res.status(500).json({ error: "Error al registrar usuario" });
  }
});

// Ruta para enviar correo de garantía
app.post('/api/enviar-garantia', authenticateToken, async (req, res) => {
  const { vendedorEmail, datosFormulario, documentoBase64, imagenes } = req.body;
  try {
    if (!documentoBase64) {
      return res.status(400).json({ success: false, error: 'El documento está vacío' });
    }
    const attachments = [{
      filename: `garantia_${Date.now()}.docx`,
      content: documentoBase64,
      encoding: 'base64'
    }];
    if (imagenes && imagenes.length > 0) {
      imagenes.forEach((img, index) => {
        const extension = img.name.split('.').pop().toLowerCase();
        attachments.push({
          filename: `imagen_${index + 1}.${extension}`,
          content: img.data,
          encoding: 'base64',
          contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`
        });
      });
    }
    const mailOptions = {
      from: `"SERMEX" <${process.env.GMAIL_USER}>`,
      to: vendedorEmail,
      subject: `Garantía - ${datosFormulario.CLIENTE || 'Cliente'}`,
      html: `<p>Solicitud de garantía enviada</p>`,
      attachments: attachments
    };
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: 'Correo enviado correctamente', attachments: attachments.length });
  } catch (error) {
    console.error('Error en el servidor:', error);
    res.status(500).json({ success: false, error: 'Error al enviar el correo', details: error.message });
  }
});

// Ruta para obtener lista de vendedores
app.get('/api/vendedores', authenticateToken, (req, res) => {
  const vendedores = [
    { id: 1, nombre: "Efren Castillo", email: "ecastillo@sermex.mx" },
    { id: 2, nombre: "Jhonatan Zavala", email: "jzavala@sermex.mx" },
    { id: 3, nombre: "Osvaldo", email: "julioosvaldoguzmancorrea53@gmail.com" }
  ];
  res.json(vendedores);
});

// 📝 Ruta para enviar evaluación
app.post("/api/evaluaciones", authenticateToken, async (req, res) => {
  const { producto_id, puntuacion, comentario, sugerencias } = req.body;
  const usuario_id = req.user.id;
  try {
    await db.query(
      "INSERT INTO evaluaciones_productos (usuario_id, producto_id, puntuacion, comentario, sugerencias) VALUES (?, ?, ?, ?, ?)",
      [usuario_id, producto_id, puntuacion, comentario, sugerencias]
    );
    res.json({ mensaje: "Evaluación guardada correctamente" });
  } catch (err) {
    console.error("Error al guardar evaluación:", err);
    res.status(500).json({ error: "Error al guardar evaluación" });
  }
});

// 🔍 Ruta para obtener evaluaciones de un producto
app.get("/api/evaluaciones/:producto_id", async (req, res) => {
  const { producto_id } = req.params;
  try {
    const [results] = await db.query(
      `SELECT e.*, u.correo 
       FROM evaluaciones_productos e
       JOIN usuarios u ON e.usuario_id = u.id
       WHERE e.producto_id = ?`,
      [producto_id]
    );
    res.json(results);
  } catch (err) {
    console.error("Error al obtener evaluaciones:", err);
    res.status(500).json({ error: "Error al obtener evaluaciones" });
  }
});

// Obtener producto por ID
app.get('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.query('SELECT * FROM productos WHERE id = ?', [id]);
    if (results.length === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener producto" });
  }
});

// 📧 Ruta de prueba para correos
app.get('/test-mail', async (req, res) => {
  try {
    await transporter.sendMail({
      to: 'julioosvaldoguzmancorrea53@gmail.com',
      from: `"Prueba SERMEX" <${process.env.GMAIL_USER}>`,
      subject: 'PRUEBA SERMEX - ' + new Date().toLocaleTimeString(),
      text: 'Si recibes esto, el correo está bien configurado',
      html: '<p>Este es un <strong>correo de prueba</strong> enviado desde SERMEX</p>'
    });
    res.send('✅ Correo de prueba enviado! Revisa tu bandeja de entrada y spam');
  } catch (error) {
    console.error('❌ Error en prueba:', error);
    res.send(`❌ Error: ${error.message}`);
  }
});

// Ruta para obtener todos los registros de logistica
app.get('/api/logistica', async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT * FROM logistica ORDER BY fecha_creacion DESC`
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Error al consultar" });
  }
});

// Ruta para obtener registros de logistica por correo
app.get('/api/logistica/:correo', async (req, res) => {
  const { correo } = req.params;
  console.log("Solicitud recibida para correo:", correo);
  try {
    const [results] = await db.query(
      `SELECT * FROM logistica WHERE correo_cliente = ? ORDER BY fecha_creacion DESC`,
      [correo]
    );
    console.log("Resultados encontrados:", results);
    res.json(results);
  } catch (err) {
    console.error("Error en BD:", err);
    res.status(500).json({ error: "Error al consultar" });
  }
});

//Nuevo Formulario - enviar solicitud de documentación/soporte
app.post('/api/enviar-solicitud', async (req, res) => {
  try {
    const { nombre, correo, telefono, empresa, producto, tipoSolicitud, descripcion, contactoPreferido } = req.body;
    if (!nombre || !correo || !telefono || !descripcion) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    const tiposSolicitud = [
      { value: "documentacion", label: "Documentación del producto" },
      { value: "soporte", label: "Soporte técnico" },
      { value: "garantia", label: "Solicitud de garantía" },
      { value: "dudas", label: "Resolución de dudas" },
      { value: "contacto", label: "Contactar con un especialista" },
      { value: "otro", label: "Otro tipo de solicitud" }
    ];
    const mailOptions = {
      from: `"Formulario SERMEX" <${process.env.GMAIL_USER}>`,
      to: 'julioosvaldoguzmancorrea53@gmail.com',
      subject: `Nueva solicitud: ${tipoSolicitud} - ${nombre}`,
      html: `
        <h2>Nueva solicitud recibida</h2>
        <p><strong>Nombre:</strong> ${nombre}</p>
        <p><strong>Correo:</strong> ${correo}</p>
        <p><strong>Teléfono:</strong> ${telefono}</p>
        <p><strong>Empresa:</strong> ${empresa || 'No especificada'}</p>
        <p><strong>Producto de interés:</strong> ${producto || 'No especificado'}</p>
        <p><strong>Tipo de solicitud:</strong> ${tiposSolicitud.find(t => t.value === tipoSolicitud)?.label || tipoSolicitud}</p>
        <p><strong>Método de contacto preferido:</strong> ${contactoPreferido}</p>
        <h3>Descripción de la solicitud:</h3>
        <p>${descripcion}</p>
        <hr>
        <p><em>Este mensaje fue enviado desde el formulario de contacto de SERMEX</em></p>
      `
    };
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Solicitud enviada correctamente' });
  } catch (error) {
    console.error('Error al enviar solicitud:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

//Segundo nuevo formulario - enviar formulario de contacto general
app.post('/api/enviar-contacto', async (req, res) => {
  try {
    const { nombre, correo, empresa, telefono, asunto, tipo, descripcion } = req.body;
    if (!nombre || !correo || !telefono || !asunto || !tipo || !descripcion) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    const tiposSolicitud = {
      "soporte": "Problema con producto",
      "asesoria": "Solicitar asesoría",
      "experto": "Hablar con un experto",
      "informacion": "Información",
      "facturacion": "Facturación",
      "otro": "Otro"
    };
    const mailOptions = {
      from: `"Formulario de Contacto SERMEX" <${process.env.GMAIL_USER}>`,
      to: 'julioosvaldoguzmancorrea53@gmail.com',
      subject: `Contacto: ${asunto} - ${nombre}`,
      html: `
        <h2>Nuevo contacto recibido</h2>
        <p><strong>Nombre:</strong> ${nombre}</p>
        <p><strong>Correo:</strong> ${correo}</p>
        <p><strong>Teléfono:</strong> ${telefono}</p>
        <p><strong>Empresa:</strong> ${empresa || 'No especificada'}</p>
        <p><strong>Asunto:</strong> ${asunto}</p>
        <p><strong>Tipo de solicitud:</strong> ${tiposSolicitud[tipo] || tipo}</p>
        <h3>Descripción:</h3>
        <p>${descripcion}</p>
        <hr>
        <p><em>Este mensaje fue enviado desde el formulario de contacto general de SERMEX</em></p>
      `
    };
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Solicitud de contacto enviada correctamente' });
  } catch (error) {
    console.error('Error al enviar contacto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🔐 Ruta para cambiar contraseña
app.post("/change-password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Todos los campos son requeridos" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }
  try {
    const [user] = await db.query("SELECT password FROM usuarios WHERE id = ?", [userId]);
    if (!user.length) return res.status(404).json({ error: "Usuario no encontrado" });
    const isMatch = await bcrypt.compare(currentPassword, user[0].password);
    if (!isMatch) return res.status(401).json({ error: "Contraseña actual incorrecta" });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE usuarios SET password = ? WHERE id = ?", [hashedPassword, userId]);
    res.json({ success: true, message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("Error en change-password:", error);
    res.status(500).json({ error: "Error en el servidor al cambiar contraseña" });
  }
});

// Ruta para actualizar el estado y notas de un pedido logístico
app.put('/api/logistica/actualizar', async (req, res) => {
  const { rma_id, nuevo_estado, notas } = req.body;
  if (!rma_id || !nuevo_estado) {
    return res.status(400).json({ error: "Los campos 'rma_id' y 'nuevo_estado' son obligatorios" });
  }
  try {
    const [result] = await db.query(
      `UPDATE logistica SET 
        estado = ?, 
        detalles = ?,
        fecha_actualizacion = CURRENT_TIMESTAMP 
        WHERE rma_id = ?`,
      [nuevo_estado, notas || null, rma_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "No se encontró el RMA especificado" });
    }
    res.json({ success: true, message: "Estado actualizado correctamente" });
  } catch (err) {
    console.error("Error en la base de datos:", err);
    res.status(500).json({ error: "Error interno al actualizar" });
  }
});

// Ruta de prueba (sin base de datos)
app.get('/api/test', (req, res) => {
  console.log("✅ Ruta /api/test funcionando");
  res.json({ mensaje: "¡El servidor responde correctamente!" });
});

// Home
app.get("/", (req, res) => {
  res.send("🚀 Servidor funcionando correctamente");
});

// Iniciar Servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});