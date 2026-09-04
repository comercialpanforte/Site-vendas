const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(cors());

const SPREADSHEET_ID = '1F1FnMddq0BxDjiJoaPLV9J3z7rpbo5SpyVXE035g0';

function getPrivateKey() {
    let key = process.env.GOOGLE_PRIVATE_KEY || '';
    // Remove aspas extras se por acaso houver
    key = key.replace(/^["']|["']$/g, '');
    // Substitui literais \n por quebras de linha reais
    return key.replace(/\\n/g, '\n');
}

async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: getPrivateKey(),
        },
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
