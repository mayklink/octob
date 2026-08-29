# whisper.cpp sidecar

Os binários são gerados automaticamente por `yarn prepare:whisper` antes do
empacotamento. Não os versione: o `electron-builder` já inclui `resources/**`.

O script fixa a revisão oficial `b4938` do `whisper.cpp` e compila os binários
no runner de cada plataforma. O modelo multilíngue é baixado somente após a
confirmação do usuário no primeiro uso.
