const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { MercadoPagoConfig, Preference } = require('mercadopago');

// Inicializa o cliente do Mercado Pago com o token configurado no Render
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const app = express();
app.use(express.json());
app.use(cors());

const SPREADSHEET_ID = '1F1fNMddqg0BxDjiJoaPLVf9J3z7rpbo5SpyVXEO35g0';
        
async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: '/etc/secrets/credenciais.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await google.sheets({ version: 'v4', auth });
}

// Rota de produtos (Mantém intacta a leitura do Google Sheets e as imagens do Drive)
app.get('/produtos', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Produto!A2:D100',
        });
        const rows = response.data.values || [];
        
        const produtos = rows.map(row => ({
            id: row[0],
            nome: row[1],
            preco: parseFloat(String(row[2]).replace(',', '.')),
            imagem: row[3] || 'HighProtein.jpg'
        }));

        res.json(produtos);
    } catch (error) {
        console.error("Erro detalhado:", error);
        res.status(500).json({ error: "Erro real: " + error.message });
    }
});

// Rota de pagamento atualizada e simplificada para evitar o bloqueio 403 do Mercado Pago
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;

        if (!itens || itens.length === 0) {
            return res.status(400).json({ error: "O carrinho está vazio." });
        }

        const itemsForMP = itens.map(item => ({
            title: `${item.quantidade}x ${item.nome} (${local})`,
            unit_price: Number(item.preco),
            quantity: Number(item.quantidade),
            currency_id: 'BRL'
        }));

        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: itemsForMP,
                back_urls: {
                    success: "https://comercialpanforte.github.io/Site-vendas/",
                    failure: "https://comercialpanforte.github.io/Site-vendas/",
                    pending: "https://comercialpanforte.github.io/Site-vendas/"
                },
                auto_return: "approved"
            }
        });

        console.log(`Preferência gerada com sucesso | ID: ${result.id}`);

        res.json({
            sucesso: true,
            id: result.id,
            init_point: result.init_point
        });

    } catch (error) {
        console.error("Erro ao gerar Pix no Mercado Pago:", error);
        res.status(500).json({ error: "Erro interno ao processar o pagamento: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
