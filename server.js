const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(cors());

// ID da sua planilha do Google Sheets
const SPREADSHEET_ID = '1F1FnMddq0BxDjiJoaPLV9J3z7r...'; // Mantenha o ID real da sua planilha aqui

async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await google.sheets({ version: 'v4', auth });
    return client;
}

app.post('/gerar-pix', async (req, res) => {
    try {
        const { local_id, produto_id, quantidade } = req.body;
        const qtdComprada = parseInt(quantidade) || 1;
        const idProdutoBusca = String(produto_id || '190'); // Padrão High Protein se não informado

        const sheets = await getGoogleSheetsClient();

        // 1. Buscar preço na aba 'Produto' (conforme sua planilha)
        const produtosRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Produto!A2:C100',
        });
        const linhasProdutos = produtosRes.data.values || [];
        
        let precoUnitario = 12.90; // Preço de segurança
        for (let row of linhasProdutos) {
            // Coluna A: produto_id, Coluna B: nome_produto, Coluna C: preco
            if (String(row[0]) === idProdutoBusca) {
                precoUnitario = parseFloat(String(row[2]).replace(',', '.'));
                break;
            }
        }

        const valorTotal = (precoUnitario * qtdComprada).toFixed(2);

        // 2. Verificar e dar baixa no estoque na aba 'Estoque'
        const estoqueRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Estoque!A2:D100',
        });
        const linhasEstoque = estoqueRes.data.values || [];
        
        let linhaEncontrada = -1;
        let estoqueAtual = 0;

        for (let i = 0; i < linhasEstoque.length; i++) {
            const row = linhasEstoque[i];
            // Coluna A: local_id, Coluna B: produto_id, Coluna C: quantidade_atual
            if (String(row[0]) === String(local_id) && String(row[1]) === idProdutoBusca) {
                linhaEncontrada = i + 2; 
                estoqueAtual = parseInt(row[2]) || 0;
                break;
            }
        }

        if (linhaEncontrada !== -1) {
            const novoEstoque = Math.max(0, estoqueAtual - qtdComprada);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `Estoque!C${linhaEncontrada}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[novoEstoque]] }
            });
        }

        // Dados simulados do PIX
        const responseData = {
            qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            qr_code_copia_e_cola: `00020126580014br.gov.bcb.pix... (PIX de R$ ${valorTotal} para ${qtdComprada}x produto ${idProdutoBusca} no local ${local_id})`,
            valor: valorTotal
        };

        res.json(responseData);

    } catch (error) {
        console.error("Erro ao processar pedido e estoque:", error);
        res.status(500).json({ error: "Erro interno ao processar o pagamento." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
