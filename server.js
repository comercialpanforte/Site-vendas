const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();

// Configurações essenciais
app.use(cors());
app.use(express.json());

// Configuração da autenticação com o Google Sheets (ajuste as credenciais conforme o seu setup original)
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // ID da sua planilha cadastrada nas variáveis de ambiente do Render

// Rota para buscar os produtos diretamente da planilha do Google Sheets
app.get('/produtos', async (req, res) => {
    try {
        const client = await auth.getClient();
        const googleSheets = google.sheets({ version: 'v4', auth: client });

        // Defina aqui a aba e o intervalo onde estão os seus produtos na planilha (ex: 'Produtos!A2:D100')
        const range = 'Produtos!A2:D100'; 

        const getRows = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = getRows.data.values;

        if (!rows || rows.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum produto encontrado na planilha." });
        }

        // Mapeia os dados da planilha para o formato que o front-end consome
        // Ajuste os índices (0, 1, 2, 3) conforme a ordem das colunas na sua planilha (ex: Nome, Preco, Imagem, ID)
        const produtos = rows.map((row, index) => ({
            id: row[3] || String(index + 1),
            nome: row[0],
            preco: parseFloat(row[1].replace('R$', '').replace(',', '.').trim()) || 0,
            imagem: row[2] || 'HighProtein.jpg'
        }));

        res.json(produtos);
    } catch (erro) {
        console.error("Erro ao buscar produtos do Google Sheets:", erro);
        res.status(500).json({ mensagem: "Erro ao carregar produtos da planilha." });
    }
});

// Rota para processar o carrinho e integrar com o Mercado Pago
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;

        if (!itens || itens.length === 0) {
            return res.status(400).json({ mensagem: "O carrinho está vazio." });
        }

        // Cálculo total dos itens enviados pelo carrinho
        let totalGeral = itens.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        console.log(`Gerando Pix para o ponto: ${local} | Total: R$ ${totalGeral.toFixed(2)}`);

        // Aqui entra a sua chamada oficial para a API do Mercado Pago utilizando suas credenciais
        // Retorne os dados de pagamento gerados para o front-end
        res.json({
            sucesso: true,
            total: totalGeral,
            mensagem: "Requisição de pagamento processada com sucesso!"
        });

    } catch (erro) {
        console.error("Erro ao gerar Pix:", erro);
        res.status(500).json({ mensagem: "Erro interno ao processar o pagamento via Mercado Pago." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
