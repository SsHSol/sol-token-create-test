/**
 * 更新链上 Token-2022 元数据 URI（GitHub 用户名变更后）
 *
 * 用法: node scripts/update-uri.js
 */
// ========== 代理配置（本机 V2Ray/Clash）==========
try {
  const { setGlobalDispatcher, ProxyAgent } = require("undici");
  setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:7897"));
} catch (_e) {}

const path = require('path');
const fs = require('fs');
const { Keypair, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');

// ===== 配置 =====
const MINT = '8Nc2JCEPBVF5dFfJfyaZrx5C3d4ggV74TZt8fQB2SRPD';
const RPC = 'https://api.mainnet-beta.solana.com';
const WALLET_PATH = path.join(__dirname, '..', 'wallet.json');

// 旧 URI 和新 URI
const OLD_URI = 'https://raw.githubusercontent.com/sshzui/sol-pool-monitor/main/token-meta-USDKT.json';
const NEW_URI = 'https://raw.githubusercontent.com/SsHSol/sol-pool-monitor/main/token-meta-USDKT.json';

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function sendTx(tx, signers) {
  const bh = await rpc('getLatestBlockhash', [{ commitment: 'processed' }]);
  tx.recentBlockhash = bh.value.blockhash;
  tx.lastValidBlockHeight = bh.value.lastValidBlockHeight;
  tx.feePayer = signers[0].publicKey;

  tx.partialSign(...signers);

  const rawTx = tx.serialize({ requireAllSignatures: false });
  const sig = await rpc('sendTransaction', [
    rawTx.toString('base64'),
    { encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed' },
  ]);

  for (let i = 0; i < 60; i++) {
    const status = await rpc('getSignatureStatuses', [[sig]]);
    if (status.value[0]?.confirmationStatus) {
      console.log(`  ✅ 确认: ${status.value[0].confirmationStatus}`);
      return sig;
    }
    const height = await rpc('getBlockHeight', [{ commitment: 'processed' }]);
    if (height > bh.value.lastValidBlockHeight) throw new Error('blockhash expired');
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('超时');
}

async function main() {
  console.log('=== 更新链上 Token-2022 URI ===');
  console.log(`Mint: ${MINT}`);
  console.log(`  旧: ${OLD_URI}`);
  console.log(`  新: ${NEW_URI}`);

  // 检查链上当前 URI
  const info = await rpc('getAccountInfo', [MINT, { encoding: 'jsonParsed' }]);
  const extensions = info.value?.data?.parsed?.info?.extensions || [];
  const metaExt = extensions.find(e => e.extension === 'tokenMetadata');
  if (!metaExt) {
    console.error('❌ 未找到 tokenMetadata 扩展');
    process.exit(1);
  }
  console.log(`\n当前链上 URI: ${metaExt.state.uri}`);
  if (metaExt.state.uri !== OLD_URI) {
    console.log(`⚠️  链上 URI 不是你预期的旧地址，可能已经改过`);
  }

  // 加载钱包
  const secret = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(secret));
  const walletPub = wallet.publicKey;
  console.log(`\n钱包: ${walletPub.toBase58()}`);

  const bal = await rpc('getBalance', [walletPub.toBase58()]);
  console.log(`余额: ${bal.value / 1e9} SOL`);
  if (bal.value < 10000) {
    console.error('❌ 余额不足');
    process.exit(1);
  }

  // 构建交易：手动编码 TokenMetadataField::Uri (variant 2)
  // 注意：createUpdateFieldInstruction 库函数把字符串 field 编码为
  // TokenMetadataField::Field(string) (variant 3)，那不是标准 URI 字段。
  // 标准 URI 必须编码为 variant 2 (0x02)。
  const mintPub = new PublicKey(MINT);
  const valueBytes = Buffer.from(NEW_URI, 'utf8');
  const valueLen = Buffer.alloc(4);
  valueLen.writeUInt32LE(valueBytes.length, 0);

  // UpdateField 指令 discriminator (sha256("spl_token_metadata:update_field") 前8字节)
  const DISCRIMINATOR = Buffer.from([221, 233, 49, 45, 181, 202, 220, 200]);
  // TokenMetadataField::Uri = variant 2 (Borsh enum, 1 byte variant index)
  const FIELD_URI = Buffer.from([0x02]);

  const data = Buffer.concat([DISCRIMINATOR, FIELD_URI, valueLen, valueBytes]);

  const ix = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { isSigner: false, isWritable: true, pubkey: mintPub },
      { isSigner: true, isWritable: false, pubkey: walletPub },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  console.log(`\n📝 发送交易...`);
  const sig = await sendTx(tx, [wallet]);
  console.log(`✅ URI 更新成功!`);
  console.log(`https://solscan.io/tx/${sig}`);
}

main().catch(e => {
  console.error(`\n❌ 失败: ${e.message}`);
  if (e.logs) console.error(e.logs.join('\n'));
  process.exit(1);
});
