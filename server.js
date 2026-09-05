const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();

// Configuração correta do CORS e suporte a JSON
app.use(cors());
app.use(express.json());

// Exemplo da sua rota de produtos (mantenha ou ajuste com a sua lógica do Google Sheets)
app.get('/produtos', async (req, res) => {
    try {
        // Coloque aqui a sua lógica atual que busca os produtos da planilha
        const produtosExemplo = [
            { id: "1", nome: "PÃO DE FORMA CASEIRO 400g", preco: 9.90, imagem: "HighProtein.jpg" },
            { id: "2", nome: "PÃO DE FORMA LEITE 400g", preco: 10.90, imagem: "HighProtein.jpg" }
        ];
        res.json(produtosExemplo);
    } catch (erro) {
        console.error("Erro ao buscar produtos:", erro);
        res.status(500).json({ mensagem: "Erro ao carregar produtos" });
    }
});

// Rota para processar o carrinho e gerar o Pix (ajuste conforme a sua integração do Mercado Pago)
app.post('/gerar-pix', async (req, res) => {
    try {
        const { local, itens } = req.body;

        if (!itens || itens.length === 0) {
            return res.status(400).json({ mensagem: "O carrinho está vazio." });
        }

        // Aqui você calcula o total real consultando os dados ou soma os itens recebidos com segurança
        let totalCalculado = itens.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        console.log(`Processando pedido para o ponto: ${local}, Total: R$ ${totalCalculado.toFixed(2)}`);

        // Insira aqui a chamada para a API do Mercado Pago para gerar a preferência/Pix
        // Exemplo de resposta simulada de sucesso:
        res.json({
            sucesso: true,
            id: "pref_exemplo_123456",
            qr_code_url: "link_do_qr_code_aqui",
            mensagem: "Pix gerado com sucesso!"
        });

    } catch (erro) {
        console.error("Erro ao gerar Pix:", erro);
        res.status(500).json({ mensagem: "Erro interno ao processar o pagamento." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
