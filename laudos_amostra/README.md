# Banco local de validação

Esta pasta pode receber laudos desidentificados e as transcrições corrigidas usadas para validar o importador.

- PDFs, imagens, OCRs e transcrições locais ficam ignorados pelo Git.
- Nunca coloque nome, prontuário, CPF, data de nascimento ou outro identificador em arquivos versionados.
- Cada novo formato de laboratório deve ser comparado com os valores corretos antes de ser aceito para preenchimento automático.
- O teste público continua funcionando sem os arquivos confidenciais; quando as transcrições locais existem, `node test_parser.js` também executa essa validação adicional.

O objetivo deste banco não é ensinar o sistema a adivinhar. Ele serve para medir regressões e ampliar, com segurança, os formatos de laudo reconhecidos.
