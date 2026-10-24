# Mail Link Bot

Gmail'i belirlediğiniz filtreyle tarar, maillerdeki bağlantıları çıkarır, seçtiğiniz
bağlantı zincirini izler, son sayfadan bir HTML elemanının değerini okur ve bunu
**Telegram**'a (grup ya da kişisel sohbet) gönderir. Tüm akış **tarif** olarak
kaydedilip otomatik çalıştırılabilir.

## Kurulum

```bash
npm install
npm start
```

Gereksinim: Node.js 20+.

### Tek dosyalık exe (Windows)

```bash
npm run dist
```

Çıktı: `dist\MailLinkBot-<sürüm>-portable.exe` — kurulum gerektirmeyen, tek dosyalık
taşınabilir uygulama (yaklaşık 70 MB).

- Her açılışta geçici klasöre açıldığı için ilk pencere birkaç saniye geç gelebilir.
- Kod imzalı olmadığından Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verebilir
  (*Ek bilgi → Yine de çalıştır*).
- Ayarlarınız exe'nin yanında değil `%APPDATA%\Mail Link Bot\` altında tutulur;
  exe'yi güncellediğinizde kaybolmaz.

## 1) Gmail uygulama şifresi

Normal Gmail şifreniz **çalışmaz**; uygulama şifresi gerekir:

1. [Google Hesabı → Güvenlik](https://myaccount.google.com/security) sayfasında
   **2 Adımlı Doğrulama**'yı etkinleştirin (uygulama şifresi için zorunlu).
2. [Uygulama şifreleri](https://myaccount.google.com/apppasswords) sayfasından yeni bir
   şifre oluşturun (16 haneli, `abcd efgh ijkl mnop` biçiminde).
3. Uygulamada **Ayarlar → Gmail** bölümüne adresinizi ve bu şifreyi girin,
   **Bağlantıyı Test Et** ile doğrulayın.

## 2) Telegram botu

Telegram Bot API **resmî ve ücretsizdir** — hesap riski yoktur.

1. Telegram'da **@BotFather**'a `/newbot` yazın, bota bir ad verin; size verilen
   **API token**'ı (örn. `123456789:AAF...`) kopyalayın.
2. Uygulamada **Ayarlar → Telegram Botu** bölümüne token'ı kaydedin,
   **Botu Doğrula** ile kontrol edin.
3. Botu, mesaj atılacak **gruba ekleyin** ve grupta herhangi bir mesaj yazın.
4. Sihirbaz'daki **"📋 Sohbetleri Bul"** butonu, botun gördüğü sohbetleri listeler;
   Chat ID alanına tıklayıp grubu seçin. (Grup ID'leri genellikle `-100…` ile başlar.
   Kişisel sohbet için bota önce özelden bir mesaj atın.)

> Not: Grubun ID'si görünmüyorsa bot grup mesajlarını göremiyor olabilir.
> @BotFather → `/setprivacy` → **Disable** yapın ya da botu grupta yönetici yapın,
> sonra grupta yeni bir mesaj yazıp tekrar deneyin.

Şifre ve token, Windows DPAPI (safeStorage) ile şifrelenerek yerel diskte saklanır.

## Kullanım (Sihirbaz)

1. **Filtre** girin (konuda geçen ifade, gönderen, içerik) → **Mailleri Tara**.
2. Eşleşen maillerden birine tıklayın → mailin içindeki **bağlantılar** listelenir.
3. Bir bağlantıya tıklayın → sayfa sağdaki önizlemede açılır; o sayfanın
   **bağlantıları (1, 2, …) ve tıklanabilir butonları (B1, B2, …)** birlikte listelenir.
   One-page (SPA) sitelerdeki buton şeklindeki geçişler de bu sayede kullanılabilir:
   butona tıklayınca sayfa aynı görünümde ilerler ve liste yenilenir.
   İstediğiniz derinliğe kadar devam edin.
4. Son sayfada **◎ Eleman Seç** ile hedef HTML elemanına tıklayın (CSS seçici
   otomatik üretilir) ya da seçiciyi elle yazın → **Değeri Oku**.
5. Telegram **Chat ID**'sini ve mesaj şablonunu girin → **Şimdi Gönder** ile deneyin.
6. **Tarif Olarak Kaydet** → akış artık otomatik: uygulama her X dakikada
   filtreye uyan **yeni** mailleri kontrol eder, zinciri yürütür, değeri Telegram'a yollar.

Mesaj şablonunda kullanılabilir alanlar: `{value}` `{subject}` `{url}` `{name}` `{date}`

Okunan değer düz metin olarak gönderilir (HTML modunda etiketler de metin olarak
gider); 4096 karakter sınırını aşan mesajlar parçalara bölünür.

## Otomasyonun adım eşleştirme mantığı

Tarif çalışırken **bağlantı adımları** şu sırayla bulunur:

1. **Birebir URL** — kaydettiğiniz bağlantı aynen sayfada varsa o açılır.
2. **Desen** — URL değişkense (ör. her mailde farklı token), kaydedilen
   `alanadı/yol` deseni URL ya da bağlantı metninde aranır.
3. **Sıra numarası** — ikisi de tutmazsa, kayıt sırasında tıkladığınız sıradaki
   bağlantı açılır.

**Buton adımları** ise: önce kaydedilen CSS seçici, bulunamazsa buton metni
(birebir → içeren), en son sıra numarası ile bulunup sayfada tıklanır.

## Notlar ve sınırlamalar

- Otomatik çalıştırma için **uygulamanın açık kalması** gerekir.
- Tarif ilk etkinleştirildiğinde mevcut mailler işlenmez; o andan **sonra gelen**
  mailler işlenir (başlangıç UID'i alınır). "▶ Çalıştır" butonu ise her zaman
  filtreye uyan en yeni maili işler.
- Giriş (login) isteyen veya CAPTCHA'lı sayfalar otomatik modda açılamaz.
- Loglar **Tarifler & Loglar** sekmesindedir. F12 ile geliştirici araçları açılır.

## Veri konumu

Ayarlar, tarifler ve çalışma durumu: `%APPDATA%\Mail Link Bot\`

Gmail uygulama şifresi ve Telegram token'ı Windows DPAPI ile şifrelenir ve yalnızca
o Windows kullanıcısı tarafından çözülebilir; ayar dosyasını başka bir bilgisayara
kopyalarsanız bilgileri yeniden girmeniz gerekir. Bu bilgiler depoya hiçbir zaman yazılmaz.

İpucu: "Bağlantıyı Test Et" butonu, forma yazdığınız (henüz kaydedilmemiş)
bilgilerle de test yapar; kalıcı olması için yine de **Kaydet**'e basın.
