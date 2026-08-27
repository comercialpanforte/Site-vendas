const express = require('express');
const cors = require('cors');
const path = require('path');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

// Diz para o Render mostrar a página HTML quando alguém abrir o link
app.use(express.static(__dirname));

const client = new MercadoPagoConfig({ accessToken: 'APP_USR-1394079011765804-082714-0b7db4ad62069207247388496e67d5ce-3644473440' });
const payment = new Payment(client);

app.post('/gerar-pix', async (req, res) => {
    const { quantidade } = req.body;
    const precoUnitario = 12.80; 
    const valorTotal = quantidade * precoUnitario;

    try {
        const request = {
            transaction_amount: valorTotal,
            description: `Pão de forma High Protein 400g. - Qtd: ${quantidade}`,
            payment_method_id: 'pix',
            payer: {
                email: 'cliente@exemplo.com' 
            }
        };

        const response = await payment.create({ body: request });

        res.json({
            qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64,
            qr_code_copia_e_cola: response.point_of_interaction.transaction_data.qr_code
        });

    } catch (error) {
        console.error("Erro ao gerar PIX:", error);
        res.status(500).json({ erro: 'Falha ao gerar o pagamento' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
