import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import moment from 'moment-timezone';
import NodeCache from 'node-cache';
import fs from 'fs';

moment.tz.setDefault('America/Sao_Paulo');

const cacheTentativasEnvio = new NodeCache();
const intervaloEnvio = 5 * 60 * 60 * 1000;
let ultimaMensagemEnviadaPorJid = {};
const authInfoPath = 'auth_info';
const linksColetadosPath = 'links_coletados.json';

let linksColetados = [];
if (fs.existsSync(linksColetadosPath)) {
    linksColetados = JSON.parse(fs.readFileSync(linksColetadosPath));
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authInfoPath);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
        auth: state,
        version,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
        const { qr, connection, lastDisconnect } = update;

        if (qr) {
            QRCode.generate(qr, { small: true }, (qrcode) => {
                console.log("Escaneie o QR Code para conectar:\n" + qrcode);
            });
        }

        if (connection === 'close') {
            if (lastDisconnect?.error) {
                const error = lastDisconnect?.error?.output?.statusCode;
                if (error === 401) {
                    console.log('Erro de autenticação. Excluindo "auth_info" e tentando novamente...');
                    excluirAuthInfo();
                    connectToWhatsApp();
                } else {
                    console.log('Reconectando ao WhatsApp...');
                    connectToWhatsApp();
                }
            }
        }

        if (connection === 'open') {
            console.log('Bot conectado com sucesso!');
        }
    });

    socket.ev.on('messages.upsert', async (messageUpdate) => {
        try {
            const { messages } = messageUpdate;
            if (!messages || messages.length === 0) return;

            const message = messages[0];
            const jid = message.key.remoteJid;

            const agora = Date.now();

            // Verificar comando !links
            if (message.message?.conversation?.toLowerCase() === '!links') {
                const resposta = linksColetados.length > 0
                    ? `Links coletados:\n${linksColetados.join('\n')}`
                    : 'Nenhum link coletado ainda.';
                await socket.sendMessage(jid, { text: resposta });
                return;
            }

            // Coletar links enviados
            const texto = message.message?.conversation;
            if (texto && texto.includes('https://chat.whatsapp.com')) {
                const linksEncontrados = texto.match(/https:\/\/chat\.whatsapp\.com\/\S+/g);
                if (linksEncontrados) {
                    for (const link of linksEncontrados) {
                        if (!linksColetados.includes(link)) {
                            linksColetados.push(link);
                            fs.writeFileSync(linksColetadosPath, JSON.stringify(linksColetados, null, 2));
                            console.log(`Novo link coletado: ${link}`);
                        }
                    }
                }
            }

            // Verificar intervalo de envio da saudação
            if (ultimaMensagemEnviadaPorJid[jid] && agora - ultimaMensagemEnviadaPorJid[jid] < intervaloEnvio) {
                console.log(`Já enviamos a saudação recentemente para ${jid}. Aguardando 5 horas para o próximo envio.`);
                return;
            }

            const saudacao = `*Alianças de Namoro, Noivado E Casamento Por R$ 50 O Par* ❤️💍

Entregamos Nas Estações de Trem, Metrô 😍🚊

_PAGAMENTO NO ATO DA ENTREGA_ 💍❤️✅

*Na Compra do Par Ganha ANEL SOLITÁRIO de BRINDE* 😻💍

Temos +50 Modelos Disponíveis Na Promoção, NÃO PERCAM 😍💍

*Todos Os Pares Com Garantia ❤️✅* 

Façam Seus Pedidos 😍💍

WhatsApp: https://wa.me/5511946805835`;

            await socket.sendMessage(jid, { text: saudacao });
            console.log(`Mensagem de saudação enviada para ${jid}.`);

            ultimaMensagemEnviadaPorJid[jid] = agora;

        } catch (error) {
            console.error('Erro ao responder mensagem:', error);
        }
    });
}

async function enviarMensagemPromocional(socket) {
    const agora = Date.now();

    try {
        console.log('Buscando grupos...');
        const grupos = await socket.groupFetchAllParticipating();
        console.log(`Grupos encontrados: ${Object.keys(grupos).length}`);

        if (!grupos || Object.keys(grupos).length === 0) {
            console.log('Nenhum grupo encontrado ou o bot não tem permissão para acessar grupos.');
            return;
        }

        const mensagem = `*Alianças de Namoro, Noivado E Casamento Por R$ 50 O Par* ❤️💍

Entregamos Nas Estações de Trem, Metrô 😍🚊

_PAGAMENTO NO ATO DA ENTREGA_ 💍❤️✅

*Na Compra do Par Ganha ANEL SOLITÁRIO de BRINDE* 😻💍

Temos +50 Modelos Disponíveis Na Promoção, NÃO PERCAM 😍💍

*Todos Os Pares Com Garantia ❤️✅* 

Façam Seus Pedidos 😍💍

WhatsApp: https://wa.me/5511946805835`;

        for (const idGrupo in grupos) {
            try {
                const grupo = grupos[idGrupo];
                console.log(`Tentando enviar mensagem para o grupo: ${grupo.subject} (${idGrupo})`);
                await socket.sendMessage(idGrupo, { text: mensagem });
                console.log(`Mensagem enviada para o grupo: ${grupo.subject}`);
            } catch (error) {
                console.error(`Erro ao enviar mensagem para o grupo ${idGrupo}:`, error);
            }
        }

    } catch (error) {
        console.error("Erro ao buscar ou enviar mensagem nos grupos:", error);
    }
}

function excluirAuthInfo() {
    try {
        fs.rmSync(authInfoPath, { recursive: true, force: true });
        console.log('Credenciais excluídas com sucesso.');
    } catch (err) {
        console.error('Erro ao excluir as credenciais:', err);
    }
}

connectToWhatsApp().catch((err) => {
    console.error('Erro ao conectar ao WhatsApp:', err);
});
