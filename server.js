const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { MercadoPagoConfig, Preference } = require('mercadopago');

// Configure o seu Access Token do Mercado Pago (pode ser via variável de ambiente process.env.MP_ACCESS_TOKEN)
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN || 'SEU_ACCESS_TOKEN_AQUI' });

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

// Rota para processar o carrinho e gerar a preferência/Pix via Mercado Pago
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;

        if (!itens || itens.length === 0) {
            return res.status(400).json({ error: "O carrinho está vazio." });
        }

        // Mapeia os itens do carrinho para o formato aceito pelo Mercado Pago
        const itemsForMP = itens.map(item => ({
            title: `${item.quantidade}x ${item.nome} (${local})`,
            unit_price: Number(item.preco),
            quantity: Number(item.quantidade),
            currency_id: 'BRL'
        }));

        // Cria a preferência de pagamento no Mercado Pago
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: itemsForMP,
                payment_methods: {
                    excluded_payment_types: [
                        { id: "credit_card" },
                        { id: "ticket" }
                    ],
                    installments: 1
                },
                statement_descriptor: "PANFORTE"
            }
        });

        console.log(`Preferência gerada para o ponto: ${local} | ID: ${result.id}`);

        // Retorna o link de inicialização/pagamento para o front-end
        res.json({
            sucesso: true,
            id: result.id,
            init_point: result.init_point, // Link para redirecionar ou abrir o pagamento
            sandbox_init_point: result.sandbox_init_point
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
