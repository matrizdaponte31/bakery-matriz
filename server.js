const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const axios = require('axios');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===================== CONFIGURAÇÕES =====================
const WAHA_URL = 'https://waha-production-8b6c.up.railway.app';
const WAHA_KEY = '594d5b24d1d94245a25f5ee35eaec663';
const WAHA_SESSION = 'default';
const PORT = process.env.PORT || 3000;

// ===================== BANCO DE DADOS =====================
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:sUHSAsUWAhoIYcCVsvXoccDwrJcCqaeo@postgres.railway.internal:5432/railway',
  ssl: process.env.DATABASE_URL?.includes('railway.internal') ? false : { rejectUnauthorized: false }
});

// ===================== REDIS =====================
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://default:vrNCipWRPylKqwNBKichXWwzcDhPusRx@redis.railway.internal:6379'
});

redisClient.on('error', (err) => console.log('Redis Error:', err));
redisClient.on('connect', () => console.log('Redis conectado!'));

// ===================== CARDÁPIO =====================
const PRODUTOS = [
  null,
  { nome: 'Pão de Trança', preco: 16 },
  { nome: 'Pão de Milho', preco: 15 },
  { nome: 'Cuca de Banana P', preco: 18 },
  { nome: 'Cuca de Banana M', preco: 24 },
  { nome: 'Cuca de Abacaxi', preco: 20 },
  { nome: 'Cuca de Goiabada', preco: 20 },
  { nome: 'Cuca de Uva', preco: 20 },
  { nome: 'Cuca de Coco', preco: 24 },
  { nome: 'Pudim P', preco: 18 },
  { nome: 'Pudim M', preco: 20 },
  { nome: 'Cuca Farofa M', preco: 20 },
  { nome: 'Cuca Farofa G', preco: 35 },
  { nome: 'Bolo Manteiga Simples', preco: 26 },
  { nome: 'Bolo Manteiga Enfeitado', preco: 35 },
  { nome: 'Bolo Manteiga Recheado', preco: 65 },
  { nome: 'Rocambole de Amendoim', preco: 23 },
  { nome: 'Rocambole de Coco', preco: 23 },
  { nome: 'Rocambole de Brigadeiro', preco: 23 },
  { nome: 'Torta de Banana', preco: 35 },
  { nome: 'Torta de Ricota', preco: 35 }
];

const HORARIOS = ['', '08h-10h', '10h-12h', '12h-14h', '14h-16h', '16h-18h', '18h-19h'];

const CARDAPIO_1 = `🍞 *CARDÁPIO DA PADARIA DA MATRIZ* 🍞

*PÃES*
1 - Pão de Trança — R$ 16,00
2 - Pão de Milho — R$ 15,00

*CUCAS FRUTADAS*
3 - Cuca de Banana P — R$ 18,00
4 - Cuca de Banana M — R$ 24,00
5 - Cuca de Abacaxi — R$ 20,00
6 - Cuca de Goiabada — R$ 20,00
7 - Cuca de Uva — R$ 20,00
8 - Cuca de Coco — R$ 24,00

*PUDINS*
9 - Pudim P — R$ 18,00
10 - Pudim M — R$ 20,00`;

const CARDAPIO_2 = `*CUCAS DOCE E FAROFA*
11 - Cuca Farofa M — R$ 20,00
12 - Cuca Farofa G — R$ 35,00

*BOLOS*
13 - Bolo Manteiga Simples — R$ 26,00
14 - Bolo Manteiga Enfeitado — R$ 35,00
15 - Bolo Manteiga Recheado — R$ 65,00

*ROCAMBOLES*
16 - Rocambole de Amendoim — R$ 23,00
17 - Rocambole de Coco — R$ 23,00
18 - Rocambole de Brigadeiro — R$ 23,00

*TORTAS*
19 - Torta de Banana — R$ 35,00
20 - Torta de Ricota — R$ 35,00

👉 Digite o *número* do produto ou *NÃO* para finalizar:`;

// ===================== REDIS HELPERS =====================
async function getEstado(chatId) {
  const key = `padaria:estado:${chatId}`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

async function setEstado(chatId, estado) {
  const key = `padaria:estado:${chatId}`;
  // Estado expira em 24 horas
  await redisClient.setEx(key, 86400, JSON.stringify(estado));
}

async function delEstado(chatId) {
  const key = `padaria:estado:${chatId}`;
  await redisClient.del(key);
}

async function setJanelaAtendimento(chatId) {
  const key = `padaria:janela:${chatId}`;
  // Janela de atendimento expira em 2 horas
  await redisClient.setEx(key, 7200, '1');
}

async function getJanelaAtendimento(chatId) {
  const key = `padaria:janela:${chatId}`;
  return await redisClient.get(key);
}

// ===================== WAHA HELPER =====================
async function enviarMensagem(chatId, texto) {
  try {
    await axios.post(`${WAHA_URL}/api/sendText`, {
      session: WAHA_SESSION,
      chatId,
      text: texto
    }, {
      headers: { 'X-Api-Key': WAHA_KEY }
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.message);
  }
}

// ===================== DB HELPER =====================
async function salvarPedido(dados) {
  const { nome, telefone, chatId, carrinho, total, retirada } = dados;
  
  const itens = carrinho.map(item => `${item.nome} x${item.quantidade}`).join(', ');
  const totalFormatado = `R$ ${total},00`;

  await db.query(
    `INSERT INTO pedidos (nome, telefone, chat_id, pedido, total, status, retirada, criado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [nome, telefone, chatId, itens, totalFormatado, 'Pendente', retirada]
  );
}

// ===================== LÓGICA DO CHATBOT =====================
async function processarMensagem(chatId, mensagem, nome, telefoneReal) {
  const msg = (mensagem || '').trim();
  const msgUpper = msg.toUpperCase();

  // Verifica se está na janela de atendimento humano (2h após pedido confirmado)
  const janela = await getJanelaAtendimento(chatId);
  if (janela) {
    console.log(`[JANELA] ${nome} (${chatId}) em janela de atendimento — bot silencioso`);
    return; // Bot fica em silêncio
  }

  // Busca estado atual no Redis
  let estado = await getEstado(chatId);

  // ===== SEM ESTADO (cliente novo ou recomeçando) =====
  if (!estado) {
    if (msgUpper === 'SIM') {
      await enviarMensagem(chatId, CARDAPIO_1);
      await new Promise(r => setTimeout(r, 500));
      await enviarMensagem(chatId, CARDAPIO_2);
      await setEstado(chatId, {
        etapa: 'aguardando_produto',
        nome,
        telefoneReal,
        carrinho: [],
        total: 0
      });
    } else {
      await enviarMensagem(chatId,
        `Seja bem-vindo(a), *${nome}*! 😊🍞\n\nNa próxima semana teremos nossa Padaria da Matriz!\nFuncionamos nas sextas e sábados, das 08h às 19h.\n\nDigite *SIM* para ver o cardápio e fazer seu pedido!`
      );
    }
    return;
  }

  // ===== AGUARDANDO PRODUTO =====
  if (estado.etapa === 'aguardando_produto') {
    const num = parseInt(msg);

    if (msgUpper === 'NÃO' || msgUpper === 'NAO') {
      await enviarMensagem(chatId,
        `Em qual dia você vai retirar?\n\n1️⃣ Sexta-feira\n2️⃣ Sábado\n\nDigite 1 ou 2:`
      );
      estado.etapa = 'aguardando_dia';
      await setEstado(chatId, estado);
      return;
    }

    if (num >= 1 && num <= 20) {
      const produto = PRODUTOS[num];
      await enviarMensagem(chatId,
        `*${produto.nome}* selecionado! ✅\n\nQuantas unidades você quer?\n(Digite só o número, por exemplo: 2)`
      );
      estado.etapa = 'aguardando_quantidade';
      estado.produtoAtual = num;
      await setEstado(chatId, estado);
    } else {
      await enviarMensagem(chatId,
        `Por favor, digite apenas o *número* do produto desejado (1 a 20).\n\nOu escreva *NÃO* para finalizar o pedido.`
      );
    }
    return;
  }

  // ===== AGUARDANDO QUANTIDADE =====
  if (estado.etapa === 'aguardando_quantidade') {
    const qtd = parseInt(msg);

    if (isNaN(qtd) || qtd < 1) {
      await enviarMensagem(chatId,
        `Por favor, digite apenas o número da quantidade.\nExemplo: 2`
      );
      return;
    }

    const produto = PRODUTOS[estado.produtoAtual];
    const subtotal = produto.preco * qtd;

    estado.carrinho.push({
      numero: estado.produtoAtual,
      nome: produto.nome,
      quantidade: qtd,
      preco: produto.preco,
      subtotal
    });
    estado.total += subtotal;
    estado.etapa = 'aguardando_produto';
    delete estado.produtoAtual;
    await setEstado(chatId, estado);

    await enviarMensagem(chatId,
      `✅ *${produto.nome} x${qtd}* anotado! (R$ ${subtotal},00)\n\nDeseja mais algum produto?\n\n${CARDAPIO_1}`
    );
    await new Promise(r => setTimeout(r, 500));
    await enviarMensagem(chatId, CARDAPIO_2);
    return;
  }

  // ===== AGUARDANDO DIA =====
  if (estado.etapa === 'aguardando_dia') {
    if (msg === '1' || msg === '2') {
      const dia = msg === '1' ? 'Sexta-feira' : 'Sabado';
      estado.dia = dia;
      estado.etapa = 'aguardando_horario';
      await setEstado(chatId, estado);

      await enviarMensagem(chatId,
        `*${dia}* selecionado! 😊\n\nQual horário você pretende buscar?\n\n1️⃣ 08h – 10h\n2️⃣ 10h – 12h\n3️⃣ 12h – 14h\n4️⃣ 14h – 16h\n5️⃣ 16h – 18h\n6️⃣ 18h – 19h\n\nDigite o número do horário:`
      );
    } else {
      await enviarMensagem(chatId,
        `Por favor, digite 1 para Sexta-feira ou 2 para Sábado.`
      );
    }
    return;
  }

  // ===== AGUARDANDO HORÁRIO =====
  if (estado.etapa === 'aguardando_horario') {
    const num = parseInt(msg);

    if (num >= 1 && num <= 6) {
      const horario = HORARIOS[num];
      const retirada = `${estado.dia} das ${horario}`;
      estado.retirada = retirada;
      estado.etapa = 'aguardando_confirmacao';
      await setEstado(chatId, estado);

      // Monta resumo
      const itensTexto = estado.carrinho
        .map(item => `• ${item.nome} x${item.quantidade} — R$ ${item.subtotal},00`)
        .join('\n');

      await enviarMensagem(chatId,
        `📋 *Resumo do seu pedido:*\n\n${itensTexto}\n\n💰 *Total: R$ ${estado.total},00*\n🗓 *Retirada: ${retirada}*\n\nEstá correto?\nDigite *SIM* para confirmar\nou *NÃO* para cancelar.`
      );
    } else {
      await enviarMensagem(chatId,
        `Por favor, digite um número de 1 a 6 para escolher o horário.`
      );
    }
    return;
  }

  // ===== AGUARDANDO CONFIRMAÇÃO =====
  if (estado.etapa === 'aguardando_confirmacao') {
    if (msgUpper === 'SIM') {
      try {
        await salvarPedido({
          nome: estado.nome,
          telefone: estado.telefoneReal,
          chatId,
          carrinho: estado.carrinho,
          total: estado.total,
          retirada: estado.retirada
        });

        await delEstado(chatId);
        await setJanelaAtendimento(chatId);

        await enviarMensagem(chatId,
          `🎉 *Pedido confirmado, ${estado.nome}!*\n\nSeu pedido foi registrado com sucesso! ✅\n🗓 Retirada: ${estado.retirada}\n\nSe tiver alguma dúvida pode responder aqui! 😊\n\nTe esperamos na Padaria da Matriz! 🙏\nQue Deus abençoe! 🍞`
        );
      } catch (err) {
        console.error('Erro ao salvar pedido:', err);
        await enviarMensagem(chatId,
          `Desculpe, ocorreu um erro ao registrar seu pedido. Por favor, tente novamente.`
        );
      }
    } else if (msgUpper === 'NÃO' || msgUpper === 'NAO') {
      await delEstado(chatId);
      await enviarMensagem(chatId,
        `❌ Pedido cancelado.\n\nSe quiser fazer um novo pedido, é só digitar *SIM*! 😊`
      );
    } else {
      await enviarMensagem(chatId,
        `Por favor, digite *SIM* para confirmar ou *NÃO* para cancelar.`
      );
    }
    return;
  }
}

// ===================== WEBHOOK DO WAHA =====================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responde imediatamente

  try {
    const body = req.body;

    // Ignora mensagens enviadas pela própria padaria
    if (body?.event !== 'message') return;
    if (body?.payload?.fromMe === true) return;

    const chatId = body?.payload?.from;
    const mensagem = body?.payload?.body;
    const nome = body?.payload?._data?.pushName || body?.payload?.pushName || 'Cliente';
    const telefoneReal = body?.payload?._data?.remoteJidAlt
      ? body.payload._data.remoteJidAlt.replace('@s.whatsapp.net', '').replace('@c.us', '')
      : chatId;

    if (!chatId || !mensagem) return;

    console.log(`[${new Date().toLocaleString('pt-BR')}] ${nome} (${telefoneReal}): ${mensagem}`);

    await processarMensagem(chatId, mensagem, nome, telefoneReal);

  } catch (err) {
    console.error('Erro no webhook:', err);
  }
});

// ===================== HEALTH CHECK =====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===================== API DE PEDIDOS (para o painel) =====================
app.get('/api/pedidos', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 200'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db.query('UPDATE pedidos SET status = $1 WHERE id = $2', [status, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Arquivar pedidos do mês e zerar tabela principal
app.post('/api/pedidos/arquivar', async (req, res) => {
  try {
    const agora = new Date();
    const mes = agora.toLocaleString('pt-BR', { month: 'long' });
    const ano = agora.getFullYear();

    // Copia pedidos para historico
    const result = await db.query(`
      INSERT INTO historico (mes, ano, nome, telefone, chat_id, pedido, total, status, retirada, criado_em)
      SELECT $1, $2, nome, telefone, chat_id, pedido, total, status, retirada, criado_em
      FROM pedidos
    `, [mes, ano]);

    const totalArquivados = result.rowCount;

    // Calcula total arrecadado no mês
    const totais = await db.query('SELECT total FROM pedidos WHERE status != $1', ['Cancelado']);
    let totalMes = 0;
    totais.rows.forEach(row => {
      const val = parseFloat((row.total || '0').replace(/[^\d,]/g,'').replace(',','.')) || 0;
      totalMes += val;
    });

    // Zera tabela principal
    await db.query('DELETE FROM pedidos');

    console.log(`[ARQUIVO] ${totalArquivados} pedidos arquivados - ${mes}/${ano} - Total: R$ ${totalMes.toFixed(2)}`);

    res.json({
      ok: true,
      arquivados: totalArquivados,
      mes,
      ano,
      totalMes: `R$ ${totalMes.toFixed(2).replace('.',',')}`
    });
  } catch (err) {
    console.error('Erro ao arquivar:', err);
    res.status(500).json({ error: err.message });
  }
});

// Histórico de meses anteriores
app.get('/api/historico', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mes, ano, COUNT(*) as total_pedidos,
      SUM(CASE WHEN status != 'Cancelado' THEN 1 ELSE 0 END) as pedidos_confirmados
      FROM historico
      GROUP BY mes, ano
      ORDER BY ano DESC, arquivado_em DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pedidos de um mês específico do histórico
app.get('/api/historico/:mes/:ano', async (req, res) => {
  try {
    const { mes, ano } = req.params;
    const result = await db.query(
      'SELECT * FROM historico WHERE mes = $1 AND ano = $2 ORDER BY criado_em DESC',
      [mes, ano]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CRIAR TABELAS =====================
async function iniciarDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255),
      telefone VARCHAR(50),
      chat_id VARCHAR(100),
      pedido TEXT,
      total VARCHAR(50),
      status VARCHAR(50) DEFAULT 'Pendente',
      retirada VARCHAR(100),
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS historico (
      id SERIAL PRIMARY KEY,
      mes VARCHAR(20),
      ano INTEGER,
      nome VARCHAR(255),
      telefone VARCHAR(50),
      chat_id VARCHAR(100),
      pedido TEXT,
      total VARCHAR(50),
      status VARCHAR(50),
      retirada VARCHAR(100),
      criado_em TIMESTAMP,
      arquivado_em TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('Tabelas verificadas/criadas!');
}

// ===================== API DE PEDIDOS (para o painel) =====================
async function iniciar() {
  await redisClient.connect();
  await iniciarDB();

  app.listen(PORT, () => {
    console.log(`🍞 Padaria BOT rodando na porta ${PORT}`);
  });
}

iniciar().catch(console.error);
