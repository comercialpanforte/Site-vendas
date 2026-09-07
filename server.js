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

// Rota para gerar Pix e registrar Venda pendente (Sem mexer no estoque antecipadamente)
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

        // Chamada ao Mercado Pago para gerar o Pix
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

        // Formata os itens vendidos (Ex: "1x PÃO DE FORMA HIGH PROTEIN 400g")
        // Como o carrinho do front-end envia apenas nome e preço, guardamos o resumo. 
        // Nota: Para a baixa exata por ID, guardamos os IDs detalhados no resumo ou salvamos em formato estruturado.
        const resumoItens = itens.map(i => `${i.quantidade}x ${i.nome} (ID:${i.id})`).join(', ');
        const dataHoraAtual = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const sheets = await getGoogleSheetsClient();

        // Registra a venda na aba "Vendas" (Colunas A até H)
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Vendas!A:H',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    dataHoraAtual,       // A: data_hora
                    paymentId,           // B: venda_id
                    paymentId,           // C: payment_id
                    localAtual,          // D: local_id
                    resumoItens,         // E: itens_vendidos
                    valorTotal.toFixed(2), // F: valor_total
                    'Pendente',          // G: status
                    'Pendente'           // H: Estoque Atualizado
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

// Rota inteligente para checar pagamentos pendentes, aprovar e dar baixa real no estoque
app.get('/verificar-vendas', async (req, res) => {
    try {
        const accessToken = process.env.MP_ACCESS_TOKEN;
        if (!accessToken) {
            return res.status(500).json({ error: "Token do Mercado Pago não configurado." });
        }

        const sheets = await getGoogleSheetsClient();

        // Busca todas as vendas registradas
        const responseVendas = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Vendas!A2:H500'
        });
        const rowsVendas = responseVendas.data.values || [];

        // Busca a tabela de estoque atual
        const responseEstoque = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Estoque!A2:C500'
        });
        const rowsEstoque = responseEstoque.data.values || [];

        let processadas = 0;

        for (let i = 0; i < rowsVendas.length; i++) {
            const row = rowsVendas[i];
            const paymentId = row[2]; // Coluna C (payment_id)
            const localId = row[3];   // Coluna D (local_id)
            const itensStr = row[4];  // Coluna E (itens_vendidos)
            const statusAtual = row[6]; // Coluna G (status)
            const estoqueStatus = row[7]; // Coluna H (Estoque Atualizado)

            // Se ainda estiver pendente de estoque, vamos checar no Mercado Pago
            if (estoqueStatus === 'Pendente' && paymentId) {
                try {
                    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                        headers: { 'Authorization': `Bearer ${accessToken.trim()}` }
                    });
                    const mpData = await mpRes.json();

                    if (mpRes.ok && mpData.status === 'approved') {
                        const rowIndex = i + 2; // Linha real na planilha

                        // 1. Executa a baixa do estoque na aba "Estoque"
                        // Extrai os itens do formato "1x Nome (ID:190)"
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
                                    const eRowIndex = e+ 2;

                                    await sheets.spreadsheets.values.update({
                                        spreadsheetId: SPREADSHEET_ID,
                                        range: `Estoque!C${eRowIndex}`,
                                        valueInputOption: 'USER_ENTERED',
                                        requestBody: { values: [[novaQtd]] }
                                    });
                                    // Atualiza em memória para próximas iterações se necessário
                                    rowsEstoque[e][2] = novaQtd;
                                    break;
                                }
                            }
                        }

                        // 2. Atualiza a aba Vendas: Status = Aprovado e Estoque Atualizado = OK
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_ID,
                            range: `G${rowIndex}:H${rowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [['Aprovado', 'OK']] }
                        });

                        processadas++;
                        console.log(`Venda ${paymentId} aprovada e estoque baixado com sucesso!`);
                    } else if (mpRes.ok && (mpData.status === 'cancelled' || mpData.status === 'rejected')) {
                        // Se foi cancelado/rejeitado, apenas marca o status para não checar toda vez
                        const rowIndex = i + 2;
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_ID,
                            range: `G${rowIndex}:H${rowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[mpData.status, 'Cancelado']] }
                        });
                    }
                } catch (mpErr) {
                    console.error(`Erro ao consultar pagamento ${paymentId}:`, mpErr);
                }
            }
        }

        res.json({ sucesso: true, mensagem: `Verificação concluída. ${processadas} venda(s) aprovada(s) e baixada(s) no estoque.` });

    } catch (error) {
        console.error("Erro ao verificar vendas:", error);
        res.status(500).json({ error: "Erro ao processar verificação: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
