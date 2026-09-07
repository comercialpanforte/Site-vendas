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

// Rota de produtos integrada com Estoque por Local
app.get('/produtos', async (req, res) => {
    try {
        const localAtual = req.query.local || 'Geral';
        const sheets = await getGoogleSheetsClient();

        // Busca dados de produtos e estoque em paralelo
        const [responseProdutos, responseEstoque] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Produto!A2:D100' }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Estoque!A2:C500' })
        ]);

        const rowsProdutos = responseProdutos.data.values || [];
        const rowsEstoque = responseEstoque.data.values || [];

        // Mapeia o estoque do local específico: { produto_id: quantidade }
        const estoquePorLocal = {};
        rowsEstoque.forEach(row => {
            const localId = String(row[0]).trim();
            const prodId = String(row[1]).trim();
            const qtd = parseInt(row[2]) || 0;

            if (localId.toLowerCase() === localAtual.toLowerCase()) {
                estoquePorLocal[prodId] = qtd;
            }
        });

        // Monta a lista de produtos cruzando com o estoque do local
        const produtos = rowsProdutos.map(row => {
            const id = String(row[0]).trim();
            const nome = row[1];
            const preco = parseFloat(String(row[2]).replace(',', '.'));
            const imagem = row[3] || 'HighProtein.jpg';
            
            // Se o local não tiver registro na aba Estoque, assume 0 por segurança
            const quantidadeEstoque = estoquePorLocal[id] !== undefined ? estoquePorLocal[id] : 0;

            return {
                id,
                nome,
                preco,
                imagem,
                estoque: quantidadeEstoque
            };
        });

        res.json(produtos);
    } catch (error) {
        console.error("Erro detalhado:", error);
        res.status(500).json({ error: "Erro real: " + error.message });
    }
});

// Rota para gerar o Pix Direto com identificação do Ponto de Venda
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

        const nomePontoVenda = local ? `Ponto: ${local}` : 'Ponto: Geral';

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken.trim()}`,
                'X-Idempotency-Key': `${Date.now()}-${Math.random()}`
            },
            body: JSON.stringify({
                transaction_amount: Number(valorTotal.toFixed(2)),
                description: `Autoatendimento Panforte - ${nomePontoVenda}`,
                payment_method_id: 'pix',
                payer: {
                    email: 'cliente@panforte.com.br',
                    first_name: nomePontoVenda,
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
        const qrCodeBase64 = pointOfIdentifier = pointOfInteraction?.transaction_data?.qr_code_base64;

        console.log(`Pix Direto gerado com sucesso | Ponto: ${local} | ID: ${data.id}`);

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
