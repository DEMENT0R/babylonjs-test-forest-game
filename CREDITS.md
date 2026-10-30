# Авторы и лицензии

## Игра

Разработка — [Максим Безрукавников](https://github.com/DEMENT0R), при участии Claude (Anthropic).

Код игры распространяется по лицензии [MIT](LICENSE). На модели из `public/models/` она не
распространяется — у них свои лицензии, перечисленные ниже.

## 3D-модели (`public/models/`)

| Файл | Модель | Автор | Лицензия |
|---|---|---|---|
| `wolf.glb` | Wolf из пака *Ultimate Animated Animals* | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `stag.glb` | Stag из пака *Ultimate Animated Animals* | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `fox.glb` | Fox из [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) | см. ниже | CC0 1.0 + **CC BY 4.0** |

### Жители леса (`public/models/residents/`)

Статичные модели без скелета; в игре они оживают за счёт кода (`src/residents/model.ts`).
Все — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), взяты с [Poly Pizza](https://poly.pizza/).

| Файл | Модель | Автор |
|---|---|---|
| `hedgehog.glb` | [Hedgehog](https://poly.pizza/m/8UNni5IvK_c) | Poly by Google |
| `squirrel.glb` | [Lowpoly Squirrel](https://poly.pizza/m/eGdXC-5V2wM) | Tipatat Chennavasin |
| `badger.glb` | [Badger](https://poly.pizza/m/fXBbhQr-T80) | Poly by Google |
| `hare.glb` | [Rabbit](https://poly.pizza/m/dyeBDJxhDwP) | Poly by Google |
| `owl.glb` | [Barn owl](https://poly.pizza/m/eSEv3rCMKbg) | Poly by Google |
| `beaver.glb` | [Beaver](https://poly.pizza/m/fwtA7VLrXPr) | Poly by Google |

CC BY 3.0 требует указывать автора: жители перечислены в разделе «Авторы» главного меню.

### Лиса — составная лицензия

- Модель: **PixelMannen** — [Fox and Shiba](https://opengameart.org/content/fox-and-shiba), CC0 1.0.
- Риг и анимации: **@tomkranis** — [Low Poly Fox by PixelMannen (animated)](https://sketchfab.com/3d-models/low-poly-fox-by-pixelmannen-animated-371dea88d7e04a76af5763f2a36866bc), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Конвертация в glTF: **@AsoboStudio** и **@scurest**.

CC BY 4.0 требует указывать автора: строка про @tomkranis выводится на экране выбора героя
и в разделе «Авторы» главного меню. Не убирайте её, пока в игре есть лиса.

## Звук

Звуковых файлов нет: ветер, птицы (включая кукушку) и шаги синтезируются в браузере
через Web Audio API в `src/audio.ts`. Лицензировать нечего.

## Код и шрифты

- [Babylon.js](https://www.babylonjs.com/) — Apache License 2.0.
- Шрифты [Unbounded](https://fonts.google.com/specimen/Unbounded) и [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — SIL Open Font License 1.1, входят в сборку из пакетов [Fontsource](https://fontsource.org/) (`src/fonts.ts`).
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) и Workbox — офлайн-кэш и обновления, MIT.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (Kazuhiko Arase) — QR-код ссылки на игру, MIT. «QR Code» — товарный знак DENSO WAVE.
