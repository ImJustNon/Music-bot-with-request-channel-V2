require("dotenv").config();

const { Client, Collection, GatewayIntentBits, Partials, ActivityType, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require("fs");
const path = require("path");
const { MoonlinkManager } = require('moonlink.js');

const config = {
    client: {
        token: process.env.CLIENT_TOKEN,
        id: process.env.CLIENT_ID,
        secret: process.env.CLIENT_SECRET,
    },
    commands: [
        new SlashCommandBuilder().setName("ping").setDescription("ตอบ Pong กลับ"),
        new SlashCommandBuilder().setName("play").setDescription("เล่นเพลง").addStringOption(option => option.setName("search").setDescription("คนหาเพลงที่โดนใจ").setRequired(true)),
    ].map(command => command.toJSON()),
    player: {
        lavalink: {
            nodes: [
                {
                    host: 'localhost',
                    port: 6558,
                    secure: false,
                    password: 'reirin',
                },
            ],
        },
    },
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
        Partials.Reaction,
    ],
});

// start
(async() =>{
    await ApplicationCommandsRegister();    
})();

// create player manager
const manager = new MoonlinkManager(config.player.lavalink.nodes, {
    autoResume: true, 
    resumeTimeout: 1000,
}, (guild, sPayload) => {
    client.guilds.cache.get(guild).shard.send(JSON.parse(sPayload));
});


client.login(config.client.token).then(async() =>{
    StartErrorEventHandlers();
    UpdateActivity();
});

// ===================================================================== Moonlink Connection Events =====================================================================
manager.on('nodeCreate', async(node) => {
    console.log(`[Moonlink] ${node.host} was connected`);   
});
// ===================================================================== Moonlink Player Events =====================================================================
manager.on('trackStart', async(player, track) =>{
    const getChannel = client.channels.cache.get(player.textChannel);
    await getChannel.send(`🟢 | กำลังเล่น : \` ${track.title} \` อยู่ที่ช่อง <#${player.voiceChannel}>`);
});

manager.on('trackEnd', async(player, track) =>{
    const getChannel = client.channels.cache.get(player.textChannel);
    await getChannel.send(`🟡 | คิวหมดเเล้ว`);
});

// ===================================================================== Discord Events =====================================================================
client.on("ready", () =>{
    manager.init(client.user.id);
    console.log(`[Client] Started Client : ${client.user.username} #${client.user.discriminator}`);
});
client.on('raw', (data) => {
    manager.packetUpdate(data);
});

client.on('interactionCreate', async interaction =>{
    if(interaction.isChatInputCommand){
        if(interaction.commandName === "ping"){
            return Ping({interaction});
        }
        if(interaction.commandName === "play"){
            return Play({interaction});
        }
    }
});

// ===================================================================== Commands =====================================================================
async function Ping({interaction}){
    return interaction.reply(`pong : ${client.ws.ping} ms`);
}
async function Play({interaction}){
    const getSearch = interaction.options.get('search').value;
    const getGuild = client.guilds.cache.get(interaction.guildId)
    const getMember = getGuild.members.cache.get(interaction.member.user.id);
    const memberVoiceChannel = getMember.voice.channel;

    const getBot = getGuild.members.cache.get(client.user.id);

    if(!memberVoiceChannel) return interaction.reply('🔴 | โปรดเข้าห้องเสียงก่อนใช้คำสั่งน่ะ');
    if(getBot.voice.channel && !memberVoiceChannel.equals(getBot.voice.channel)) return interaction.reply('🔴 | ดูเหมือนว่าคุณจะไม่ได้อยู่ช่องเสียงเดียวกันน่ะ');
    if(!getSearch) return interaction.reply('🔴 | โปรดระบุเพลงที่ต้องการด้วยน่ะ');

    let player = manager.players.create({
        guildId: interaction.guild.id,
        voiceChannel: memberVoiceChannel.id,
        textChannel: interaction.channel.id,
        autoPlay: true,
    });
    if (!player.connected) player.connect({
        setDeaf: false,
        setMute: false,
    });

    let searchResults = await manager.search(getSearch);

    if(searchResults.loadType === "loadfailed"){
        return interaction.reply({
            content: `🔴 | ไม่สามารถโหลดผลการค้นหาได่`
        }); 
    } 
    else if(searchResults.loadType === "empty"){
        return interaction.reply({
            content: `🔴 | ไม่พบผลการค้นหา`
        });
    }
    if(searchResults.loadType === 'playlist'){
        for (const track of searchResults.tracks) {
            player.queue.add(track);
        }
        interaction.reply({
            content: `🟢 | เพิ่ม playlist : \` ${searchResults.playlistInfo.name} \` เข้าไปในคิวเเล้ว`,
        });
    } 
    else {
        player.queue.add(searchResults.tracks[0]);
        interaction.reply({
            content: `🟢 | เพิ่ม : \` ${searchResults.tracks[0].title} \` เข้าไปในคิวเเล้ว`,
        });
    }

    if (!player.playing){ 
        await player.play();
    }
}

// ===================================================================== Functions =====================================================================
async function ApplicationCommandsRegister(){
    const rest = new REST({ version: "10" }).setToken(config.client.token);
    try {
        console.log('[Application Commands] Started refreshing global (/) commands.');
    
        await rest.put(Routes.applicationCommands(config.client.id), { 
            body: config.commands, 
        });
        console.log('[Application Commands] Successfully reloaded global (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

function StartErrorEventHandlers(){
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[antiCrash] :: [unhandledRejection]');
        console.log(promise, reason);
    });
    process.on("uncaughtException", (err, origin) => {
        console.error('[antiCrash] :: [uncaughtException]');
        console.log(err, origin);
    });
    process.on('uncaughtExceptionMonitor', (err, origin) => {
        console.error('[antiCrash] :: [uncaughtExceptionMonitor]');
        console.log(err, origin);
    });
}

async function UpdateActivity() {
    setInterval(() =>{
        try{
            client.user.setActivity({
                activities: [
                    {
                        name: `/help | ${client.guilds.cache.size} เซิฟเวอร์`, 
                        type: ActivityType.Streaming,
                        url: "https://www.twitch.tv/im_just_non",
                    }
                ],
                status: 'online',
            });
        }
        catch(e){
            client.user.setPresence({
                activities: [
                    {
                        name: `/help | ${client.guilds.cache.size} เซิฟเวอร์`, 
                        type: ActivityType.Streaming,
                        url: "https://www.twitch.tv/im_just_non",
                    }
                ],
                status: 'online',
            });
        }
    }, 10 * 1000);
}