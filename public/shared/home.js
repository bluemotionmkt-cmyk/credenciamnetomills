// Página inicial: no ambiente de demonstração mostra os atalhos e os acessos de teste.
(async () => {
  try {
    const r = await fetch('/api/public/demo-links');
    if (!r.ok) return;
    const d = await r.json();
    const el = document.getElementById('demo');
    el.innerHTML = `
      <h2>Ambiente de demonstração — dados fictícios</h2>
      <p>Abra cada tela em uma aba (ou em outro aparelho na mesma rede) para ver tudo funcionando junto.</p>
      <div class="links">
        ${d.totem ? `<a class="btn btn-acao" href="${d.totem}" target="_blank" rel="noopener">Abrir o totem</a>` : ''}
        <a class="btn btn-primary" href="/admin" target="_blank" rel="noopener">Painel administrativo</a>
        <a class="btn" href="/vendedor" target="_blank" rel="noopener">Vendedor</a>
        <a class="btn" href="/recepcao" target="_blank" rel="noopener">Recepção</a>
      </div>
      <table><tr><td>Administrador</td><td><b>admin</b></td></tr><tr><td>Recepção</td><td><b>recepcao</b></td></tr>
      <tr><td>Vendedores</td><td><b>ana.souza</b>, <b>bruno.lima</b>, <b>carla.mendes</b>…</td></tr><tr><td>Senha de todos</td><td><b>demo1234</b></td></tr></table>`;
    el.hidden = false;
  } catch { /* produção: nada a mostrar */ }
})();
