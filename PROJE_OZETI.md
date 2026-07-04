# Baret (Casper) — Proje Özeti

Bu doküman projedeki her şeyi sade bir dille anlatır. Kod bilmek gerekmez.

> Not: Bu dosyanın önceki sürümü, bu repodan kaldırılmış eski bir Solana/Stellar
> prototipini ("DeltaG/Blackthorn") anlatıyordu. Aşağıdaki içerik, repodaki
> gerçek kodla (Casper, x402, Odra kontratları) eşleşecek şekilde yeniden
> yazılmıştır.

---

## Tek Cümlede Ne Bu?

Baret, bir Casper cüzdanı bir işlemi imzalamadan önce araya giren ve "bu
işlem güvenli mi?" sorusuna cevap veren bir güvenlik katmanı; ayrıca x402
mikro-ödeme protokolü için, bir AI agent'ın harcamasını zincir üzerinde
sınırlayan bir ödeme kasası (`PaymentGuard`) sunar.

---

## Problem Ne?

Bir kullanıcı ya da otonom bir AI agent bir Casper işlemine imza atmak üzere:

- Arka planda hangi kontratın çağrıldığı, bakiyenin nereye gittiği net değil
- Bir agent'a "her istekte otomatik öde" izni verildiğinde, harcamanın üst
  sınırı yoksa kontrolsüz büyüyebilir
- x402 gibi "ödeme kanıtı = imza" protokollerinde, imzanın gerçekten iddia
  edilen hesaptan geldiği doğrulanmazsa ödeme kimliği sahtelenebilir

Baret bu üç soruna karşılık veriyor: imzalamadan önce analiz, zincir üstünde
harcama tavanı, ve x402 imzalarında imzalayanın hesabını doğrulama.

---

## Proje Yapısı

```
CasperBaret/
├── apps/
│   ├── server/      ← Fastify API: /v1/analyze, x402 ödeme kapısı, dahili facilitator
│   ├── extension/   ← Chrome MV3 cüzdan (window.baret enjekte eder)
│   └── showcase/    ← Belirli saldırı senaryolarını canlandıran demo dApp'ler
├── packages/
│   ├── casper-core/     ← Casper anahtar/adres/x402 EIP-712 istemcisi
│   ├── casper-guard/    ← Zincir-bağımsız analiz/policy tipleri
│   ├── ext-protocol/    ← Cüzdan içi mesaj protokolü
│   ├── blackthorn-adapter/ ← dApp entegrasyon SDK'sı (paket adı tarihi, chain Casper)
│   └── ui/              ← Tasarım tokenleri
└── contracts/        ← Odra (Rust) akıllı kontratlar: PaymentGuard + Cep18x402
```

`blackthorn`, `DeltaG`, `Scrybe` gibi isimler eski prototipten kalma
markalama — hiçbiri farklı bir zincire işaret etmiyor, hepsi Casper'a konuşuyor.

---

## Ana Motor — Pre-sign Analiz

1. İstek gelir: imzalanacak işlem, hedef ağ, policy kuralları
2. İşlem decode edilir: hangi kontrat/entry point çağrılıyor, bakiyeler nasıl değişiyor
3. Risk dedektörleri çalışır (`apps/server/src/analyze/detectors.ts`)
4. Policy motoru bulguları değerlendirip `safe: true/false` + gerekçe döner

Cüzdan eklentisi aynı mantığı yerel olarak ya da bu sunucuya sorarak
çalıştırabilir — sonuç her iki yoldan da tutarlıdır.

---

## x402 Ödeme Sistemi

`packages/casper-core/src/x402.ts` — EIP-712 tipli `TransferWithAuthorization`
mesajı (make-software/casper-x402 facilitator'ı ile uyumlu):

```
1. İstemci ödemesiz bir kaynağı ister (ör. GET /demo/scrybe)
2. Sunucu 402 döner: PaymentRequirements (asset, tutar, payTo, domain bilgisi)
3. İstemci TransferWithAuthorization mesajını imzalar, X-PAYMENT header'ında gönderir
4. Sunucu imzayı doğrular (dahili facilitator veya harici make-software/casper-x402):
   digest yeniden kurulur, beyan edilen public key'in authorization.from ile
   eşleştiği kontrol edilir, sonra EIP-712 imzası doğrulanır
5. Doğrulama geçerse asıl iş (ör. analiz) çalışır
6. O da başarılıysa settlement (ödeme kesinleştirme) tetiklenir
```

**Settlement iki modda çalışır:**

- **Demo modu** (`X402_DEMO_MODE=true`, showcase'in varsayılanı): sunucunun
  hazine cüzdanından kendine gerçek bir CSPR transferi yapılır — dönen tx
  hash gerçek ve explorer'da görünür, ama payer'dan payee'ye hiçbir token
  hareket etmez.
- **Gerçek settlement**: `Cep18x402` kontratının `transfer_with_authorization`
  fonksiyonunu çağırır. Kontrat digest'i ve imzalayanın hesap hash'ini
  bağımsız olarak yeniden hesaplar — sunucunun "doğruladım" demesine
  güvenmez — ve token'ları önceden bir `approve` gerekmeden doğrudan
  payer'dan payee'ye taşır. Replay koruması `(from, nonce)` bazında.

**Önemli sınırlama:** `sigScheme: "casperMessage"` (signMessage(string)
dışında bir imzalama sunmayan cüzdanlar için, ör. resmi Casper Wallet) birden
fazla olası byte kodlamasını deneyerek doğrulanıyor — hangisinin gerçek
cüzdan davranışına karşılık geldiği bu ortamda canlı test edilerek teyit
edilemedi. Bu yol sadece off-chain/demo doğrulamayı destekliyor; gerçek
zincir üstü settlement sadece `"raw"` şemasını kabul ediyor.

---

## Kontratlar (Odra / Rust)

### `Cep18x402`

Standart bir CEP-18 token + `transfer_with_authorization`: EIP-3009 tarzı
imza ile yetkilendirilen meta-transfer. `contracts/src/eip712.rs`,
`casper-core`'daki JS hash algoritmasının (keccak256, aynı domain/struct
düzeni) birebir Rust karşılığıdır — iki taraf arasında ortak bir "golden
vector" testiyle eşleştirilmiştir.

### `PaymentGuard`

Zincir üstü harcama-tavanı kasası: sahip token yatırır, her merchant için
işlem-başı ve günlük tavan tanımlar (`set_allowance`), isterse günlük
ödemeleri bir agent cüzdanına devreder (`set_agent`). `pay(merchant, amount)`
**sadece sahip veya atanmış agent** tarafından çağrılabilir — kayıtsız,
duraklatılmış/iptal edilmiş bir merchant'a veya tavanı aşan bir tutara
giden ödeme reddedilir.

Derleme: `contracts/` içinde `cargo odra build` → `contracts/wasm/*.wasm`.
Bu wasm dosyaları repoya committed binary — kontrat kaynağı değiştiğinde
yeniden derleyip commit etmek gerekiyor.

---

## Cüzdan Eklentisi (Chrome MV3)

`apps/extension/` — sayfaya `window.baret` enjekte eder (Casper-wallet
uyumlu), imzalamadan önce pre-sign analiz çalıştırır, x402 ödemelerinde
alıcı taraf olur.

---

## Showcase

`apps/showcase/src/sites/*` — her biri belirli bir saldırı senaryosunu
(sınırsız approval, drainer transfer, sahte mint, vb.) canlandıran demo
dApp'ler. `sites/scrybe` yukarıdaki x402 demosu.

---

## Bilinen Sınırlılıklar (özet — detay için `LIMITATIONS.md`)

- Pre-sign analiz, gerçek RPC simülasyonu değil, decode edilmiş niyet üzerine kurulu.
- x402 demo modu gerçek token hareketi yapmaz (sadece gerçek görünümlü bir tx hash).
- `casperMessage` imza şeması hâlâ deneysel; gerçek cüzdan davranışı teyit edilmedi.
- Kontrat wasm dosyaları CI'da otomatik derlenmiyor; elle güncellenmesi gerekiyor.
- `PaymentGuard`'da tek agent slotu var; çoklu agent desteği yok.
