const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

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

// Rota para processar o carrinho e gerar o Pix
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;

        if (!itens || itens.length === 0) {
            return res.status(400).json({ error: "O carrinho está vazio." });
        }

        // Soma o total do carrinho enviado pelo front-end com segurança
        let totalGeral = itens.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        console.log(`Processando pedido Pix | Local: ${local} | Total: R$ ${totalGeral.toFixed(2)}`);

        // Aqui você insere a chamada para a API do Mercado Pago utilizando suas credenciais
        // Retornamos o sucesso para o front-end
        res.json({
            sucesso: true,
            total: totalGeral,
            mensagem: "Pedido recebido e pronto para pagamento!"
        });

    } catch (error) {
        console.error("Erro ao gerar Pix:", error);
        res.status(500).json({ error: "Erro interno ao gerar o pagamento: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
