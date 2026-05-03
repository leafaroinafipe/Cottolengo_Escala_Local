# Como rodar o app (Painel Admin)

## Pré-requisito (uma vez na vida)
Instalar o **Node.js**: <https://nodejs.org/>
Escolha a versão **LTS** e instale com as opções padrão.

## Como abrir no dia-a-dia
1. Dê duplo-clique no arquivo **`iniciar-app.bat`**
2. Espere aparecer no terminal algo como:
   ```
   Local:   http://localhost:5173/Cottolengo_Escala_Local/
   ```
3. Copie essa URL e cole no Chrome ou Edge
4. Pronto! O painel abre

> **Importante:** não feche a janela preta do terminal enquanto estiver usando o app — ela é o servidor que mantém o app no ar. Quando terminar de usar, pode fechar normalmente.

## Por que mudou?
O app antigo era HTML+JS puro e abria com duplo-clique. O novo usa React+Vite, que precisa de um pequeno servidor local. O `iniciar-app.bat` automatiza tudo — você só clica e usa.

## Solução de problemas

**"Node.js nao encontrado"**
Instale o Node.js primeiro: <https://nodejs.org/>

**"Falha ao instalar dependencias"**
Verifique sua conexão com a internet e tente novamente.

**Tela branca no navegador**
1. Pressione **Ctrl+Shift+R** para forçar recarga
2. Se não resolver: F12 → aba **Application** → **Service Workers** → **Unregister** → recarregue

**A janela do terminal fecha sozinha sem mostrar nada**
Significa que houve um erro. Abra o terminal manualmente:
1. Tecle **Win + R**, digite `cmd` e dê Enter
2. Cole: `cd /d "C:\Users\happy\OneDrive\Área de Trabalho\Projetos\Projetos Cottolengo\Projeto Escalas\Local_Novo_Projeto"`
3. Cole: `npm run dev`
4. Veja a mensagem de erro que aparece e me mande
