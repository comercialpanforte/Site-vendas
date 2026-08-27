const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

// Configure o Mercado Pago com seu Access Token
const client = new MercadoPagoConfig({ accessToken: 'APP_USR-1394079011765804-082714-0b7db4ad62069207247388496e67d5ce-3644473440' });
const payment = new Payment(client);

// Rota que o nosso site vai chamar quando o cliente clicar em "Pagar"
app.post('/gerar-pix', async (req, res) => {
    const { quantidade } = req.body;
    const precoUnitario = 12.90; // Preço do seu produto
    const valorTotal = quantidade * precoUnitario;

    try {
        const request = {
            transaction_amount: valorTotal,
            description: `Kit de Pães Especiais - Qtd: ${quantidade}`,
            payment_method_id: 'pix',
            payer: {
                // O Mercado Pago exige um email, podemos pedir na tela ou gerar um genérico para agilizar
                email: 'cliente@exemplo.com' 
            }
        };

        const response = await payment.create({ body: request });

        // Retorna o QR Code e o código Copia e Cola para a tela do cliente
        res.json({
            qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64,
            qr_code_copia_e_cola: response.point_of_interaction.transaction_data.qr_code
        });

    } catch (error) {
        console.error("Erro ao gerar PIX:", error);
        res.status(500).json({ erro: 'Falha ao gerar o pagamento' });
    }
});

app.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});