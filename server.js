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

        const [responseProdutos, responseEstoque] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Produto!A2:D100' }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Estoque!A2:C500' })
        ]);

        const rowsProdutos = responseProdutos.data.values || [];
        const rowsEstoque = responseEstoque.data.values || [];

        const estoquePorLocal = {};
        rowsEstoque.forEach(row => {
            const localId = String(row[0]).trim();
            const prodId = String(row[1]).trim();
            const qtd = parseInt(row[2]) || 0;

            if (localId.toLowerCase() === localAtual.toLowerCase()) {
                estoquePorLocal[prodId] = qtd;
            }
        });

        const produtos = rowsProdutos.map(row => {
            const id = String(row[0]).trim();
            const nome = row[1];
            const preco = parseFloat(String(row[2]).replace(',', '.'));
            const imagem = row[3] || 'HighProtein.jpg';
            
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

// Rota para gerar Pix e registrar Venda pendente
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;
        const localAtual = local || 'Geral';

        if (!itens || itens.length === 0) {
            return res.status(400).json({ error: "O carrinho está vazio." });
        }

        const valorTotal = itens.reduce((acc, item) => acc + (Number(item.preco) * Number(item.quantidade)), 0);

        const accessToken = process.env.MP_ACCESS_TOKEN;
        if (!accessToken) {
            return res.status(500).json({ error: "Token do Mercado Pago não configurado no servidor." });
        }

        const nomePontoVenda = `Ponto: ${localAtual}`;

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
        const qrCodeBase64 = pointOfInteraction?.transaction_data?.qr_code_base64;
        const paymentId = data.id;

        const resumoItens = itens.map(i => `${i.quantidade}x ${i.nome} (ID:${i.id})`).join(', ');
        const dataHoraAtual = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const sheets = await getGoogleSheetsClient();

        // Registra a venda deixando as colunas de dados fiscais (I, J, K, L) vazias inicialmente
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Vendas!A:L',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    dataHoraAtual,         // A: data_hora
                    paymentId,             // B: venda_id
                    paymentId,             // C: payment_id
                    localAtual,            // D: local_id
                    resumoItens,           // E: itens_vendidos
                    valorTotal.toFixed(2), // F: valor_total
                    'Pendente',            // G: status
                    'Pendente',            // H: Estoque Atualizado
                    '',                    // I: email
                    '',                    // J: whatsapp
                    '',                    // K: cpf
                    ''                     // L: nome
                ]]
            }
        });

        console.log(`Pix gerado e venda ${paymentId} registrada como Pendente.`);

        res.json({
            sucesso: true,
            id: paymentId,
            qr_code: qrCodeData,
            qr_code_base64: qrCodeBase64
        });

    } catch (error) {
        console.error("Erro ao processar Pix:", error);
        res.status(500).json({ error: "Erro interno ao processar o pagamento: " + error.message });
    }
});

// Nova Rota para salvar os dados fiscais (Nome, CPF, E-mail e WhatsApp) solicitados pelo cliente
app.post('/salvar-dados-fiscal', async (req, res) => {
    try {
        const { payment_id, nome, email, whatsapp, cpf } = req.body;

        if (!payment_id) {
            return res.status(400).json({ error: "ID de pagamento não informado." });
        }

        const sheets = await getGoogleSheetsClient();

        // Busca as vendas para localizar a linha correspondente ao pagamento
        const responseVendas = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Vendas!A2:L500'
        });
        const rowsVendas = responseVendas.data.values || [];

        let vendaIndex = -1;
        for (let i = 0; i < rowsVendas.length; i++) {
            if (String(rowsVendas[i][2]) === String(payment_id)) {
                vendaIndex = i;
                break;
            }
        }

        if (vendaIndex === -1) {
            return res.status(404).json({ error: "Venda não encontrada na planilha." });
        }

        const rowIndex = vendaIndex + 2; // Linha real na planilha (considerando cabeçalho)

        // Atualiza as colunas I (email), J (whatsapp), K (cpf) e L (nome) daquela linha
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Vendas!I${rowIndex}:L${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    email || '',
                    whatsapp || '',
                    cpf || '',
                    nome || ''
                ]]
            }
        });

        console.log(`Dados fiscais salvos com sucesso para a venda ${payment_id}`);
        res.json({ sucesso: true, mensagem: "Dados fiscais salvos com sucesso!" });

    } catch (error) {
        console.error("Erro ao salvar dados fiscais:", error);
        res.status(500).json({ error: "Erro interno ao salvar dados fiscais: " + error.message });
    }
});

// Função interna reutilizável para processar a aprovação e a baixa no estoque
async function processarAprovacaoPagamento(paymentId) {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${accessToken.trim()}` }
    });
    const mpData = await mpRes.json();

    if (!mpRes.ok || mpData.status !== 'approved') {
        return { processado: false, motivo: 'Pagamento não aprovado ou não encontrado' };
    }

    const sheets = await getGoogleSheetsClient();

    const responseVendas = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Vendas!A2:L500'
    });
    const rowsVendas = responseVendas.data.values || [];

    let vendaIndex = -1;
    let vendaRow = null;

    for (let i = 0; i < rowsVendas.length; i++) {
        if (String(rowsVendas[i][2]) === String(paymentId)) {
            vendaIndex = i;
            vendaRow = rowsVendas[i];
            break;
        }
    }

    if (vendaIndex === -1 || !vendaRow) {
        return { processado: false, motivo: 'Venda não localizada na planilha' };
    }

    // Se o estoque já foi atualizado para esta venda, evita duplicidade
    if (vendaRow[7] === 'OK') {
        return { processado: true, motivo: 'Estoque já havia sido baixado anteriormente' };
    }

    const localId = vendaRow[3];
    const itensStr = vendaRow[4];

    // Busca o estoque atual
    const responseEstoque = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Estoque!A2:C500'
    });
    const rowsEstoque = responseEstoque.data.values || [];

    // Executa a baixa do estoque
    const regexItem = /(\d+)x\s+([^(]+)\(ID:(\d+)\)/g;
    let match;
    while ((match = regexItem.exec(itensStr)) !== null) {
        const qtdComprada = parseInt(match[1]);
        const prodId = match[3];

        for (let e = 0; e < rowsEstoque.length; e++) {
            const eRow = rowsEstoque[e];
            const eLocal = String(eRow[0]).trim();
            const eProdId = String(eRow[1]).trim();
            const eQtdAtual = parseInt(eRow[2]) || 0;

            if (eLocal.toLowerCase() === localId.toLowerCase() && eProdId === prodId) {
                const novaQtd = Math.max(0, eQtdAtual - qtdComprada);
                const eRowIndex = e + 2;

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `Estoque!C${eRowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[novaQtd]] }
                });
                break;
            }
        }
    }

    // Atualiza o status na aba Vendas
    const rowIndex = vendaIndex + 2;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `G${rowIndex}:H${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Aprovado', 'OK']] }
    });

    console.log(`Webhook: Venda ${paymentId} aprovada e estoque baixado com sucesso!`);
    return { processado: true };
}

// Rota de Webhook que recebe os avisos automáticos do Mercado Pago
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        console.log("Webhook recebido do MP:", body);

        if (body.type === 'payment' || body.action === 'payment.created' || body.action === 'payment.updated') {
            const paymentId = body.data?.id || body.id;
            if (paymentId) {
                await processarAprovacaoPagamento(paymentId);
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error("Erro no processamento do Webhook:", error);
        res.status(500).send('Erro interno');
    }
});

// Rota de segurança manual
app.get('/verificar-vendas', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const responseVendas = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Vendas!A2:L500'
        });
        const rowsVendas = responseVendas.data.values || [];
        let totalProcessados = 0;

        for (const row of rowsVendas) {
            const paymentId = row[2];
            const estoqueStatus = row[7];

            if (estoqueStatus === 'Pendente' && paymentId) {
                const resultado = await processarAprovacaoPagamento(paymentId);
                if (resultado.processado) totalProcessados++;
            }
        }

        res.json({ sucesso: true, mensagem: `Verificação manual concluída. ${totalProcessados} venda(s) processada(s).` });
    } catch (error) {
        console.error("Erro na verificação manual:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
