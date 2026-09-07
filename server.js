O que aconteceu é que todo o código do server.js foi colado de uma vez só em uma única linha contínua, o que faz o Node.js não conseguir ler o arquivo corretamente.

Para corrigir e organizar o seu arquivo server.js com as quebras de linha certas, basta copiar o código formatado abaixo e colá-lo inteiro no Render:

JavaScript
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

// Rota de produtos (Mantém a planilha e imagens do Drive)
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

// Rota para gerar o Pix de forma Direta
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;

        if (!itens || itens.length === 0) {
            return res.status(400).json({ error: "O carrinho está vazio." });
        }

        const valorTotal = itens.reduce((acc, item) => acc + (Number(item.preco) * Number(item.quantidade)), 0);

        const accessToken = process.env.MP_ACCESS_TOKEN;
        if (!accessToken) {
            return res.status(500).json({ error: "Token do Mercado Pago não configurado no servidor." });
        }

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken.trim()}`,
                'X-Idempotency-Key': `${Date.now()}-${Math.random()}`
            },
            body: JSON.stringify({
                transaction_amount: Number(valorTotal.toFixed(2)),
                description: `Autoatendimento Panforte - ${local}`,
                payment_method_id: 'pix',
                payer: {
                    email: 'cliente@panforte.com.br',
                    first_name: 'Cliente',
                    last_name: 'Panforte',
                    identification: {
                        type: 'CPF',
                        number: '00000000000'
                    }
                }
            })
        });

        const data = await mpResponse.json();

        if (!mpResponse.ok) {
            console.error("Erro retornado pelo Mercado Pago (Pix Direto):", data);
            return res.status(500).json({ error: data.message || "Erro ao gerar pagamento Pix direto." });
        }

        const pointOfInteraction = data.point_of_interaction;
        const qrCodeData = pointOfInteraction?.transaction_data?.qr_code;
        const qrCodeBase64 = pointOfInteraction?.transaction_data?.qr_code_base64;

        console.log(`Pix Direto gerado com sucesso | ID: ${data.id}`);

        res.json({
            sucesso: true,
            id: data.id,
            qr_code: qrCodeData,
            qr_code_base64: qrCodeBase64
        });

    } catch (error) {
        console.error("Erro ao gerar Pix Direto:", error);
        res.status(500).json({ error: "Erro interno ao processar o Pix: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
