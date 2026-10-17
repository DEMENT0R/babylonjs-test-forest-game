# Авторы и лицензии

## Игра

Разработка — [Максим Безрукавников](https://github.com/DEMENT0R), при участии Claude (Anthropic).

## 3D-модели (`public/models/`)

| Файл | Модель | Автор | Лицензия |
|---|---|---|---|
| `wolf.glb` | Wolf из пака *Ultimate Animated Animals* | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `stag.glb` | Stag из пака *Ultimate Animated Animals* | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `fox.glb` | Fox из [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) | см. ниже | CC0 1.0 + **CC BY 4.0** |

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
- Шрифты [Unbounded](https://fonts.google.com/specimen/Unbounded) и [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — SIL Open Font License 1.1, подключаются с Google Fonts.
