<?php
declare(strict_types=1);

mb_internal_encoding('UTF-8');

function limpar_nome_arquivo(string $texto): string {
    $texto = trim($texto);
    $texto = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $texto);
    $texto = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $texto);
    $texto = preg_replace('/-+/', '-', $texto);
    $texto = trim($texto, '-');
    return $texto !== '' ? strtolower($texto) : 'arquivo';
}

function campo(array $origem, string $chave): string {
    return isset($origem[$chave]) ? trim((string)$origem[$chave]) : '';
}

function checkbox(array $origem, string $chave): string {
    return isset($origem[$chave]) ? 'Sim' : 'Não';
}

function garantir_pasta(string $caminho): void {
    if (!is_dir($caminho)) {
        mkdir($caminho, 0775, true);
    }
}

function salvar_upload(string $campo, string $destinoBase, array $permitidas): ?string {
    if (!isset($_FILES[$campo]) || $_FILES[$campo]['error'] !== UPLOAD_ERR_OK) {
        return null;
    }

    $nomeOriginal = $_FILES[$campo]['name'];
    $tmp = $_FILES[$campo]['tmp_name'];

    $ext = strtolower(pathinfo($nomeOriginal, PATHINFO_EXTENSION));
    if (!in_array($ext, $permitidas, true)) {
        return null;
    }

    $nomeFinal = $campo . '.' . $ext;
    $destino = $destinoBase . DIRECTORY_SEPARATOR . $nomeFinal;

    if (!move_uploaded_file($tmp, $destino)) {
        return null;
    }

    return $nomeFinal;
}

function escapar_pdf_texto(string $texto): string {
    $texto = str_replace(["\\", "(", ")"], ["\\\\", "\\(", "\\)"], $texto);
    $texto = preg_replace("/[\r\n\t]+/", " ", $texto);
    return $texto;
}

function gerar_pdf_simples(string $arquivoPdf, string $titulo, array $linhas): bool {
    $fontSize = 11;
    $leading = 16;
    $y = 800;
    $conteudo = "BT\n/F1 {$fontSize} Tf\n50 {$y} Td\n";

    $titulo = escapar_pdf_texto($titulo);
    $conteudo .= "({$titulo}) Tj\n0 -" . ($leading + 4) . " Td\n";

    foreach ($linhas as $linha) {
        $linha = escapar_pdf_texto($linha);
        if ($y < 80) {
            break;
        }
        $conteudo .= "({$linha}) Tj\n0 -{$leading} Td\n";
        $y -= $leading;
    }

    $conteudo .= "ET";
    $len = strlen($conteudo);

    $pdf = "%PDF-1.4\n";

    $offsets = [];

    $offsets[1] = strlen($pdf);
    $pdf .= "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";

    $offsets[2] = strlen($pdf);
    $pdf .= "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";

    $offsets[3] = strlen($pdf);
    $pdf .= "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n";

    $offsets[4] = strlen($pdf);
    $pdf .= "4 0 obj\n<< /Length {$len} >>\nstream\n{$conteudo}\nendstream\nendobj\n";

    $offsets[5] = strlen($pdf);
    $pdf .= "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";

    $xref = strlen($pdf);
    $pdf .= "xref\n0 6\n";
    $pdf .= "0000000000 65535 f \n";
    for ($i = 1; $i <= 5; $i++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }

    $pdf .= "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";

    return file_put_contents($arquivoPdf, $pdf) !== false;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo 'Método não permitido.';
    exit;
}

$baseDir = __DIR__ . DIRECTORY_SEPARATOR . 'livros-de-autores';
garantir_pasta($baseDir);

$nomeAutor = campo($_POST, 'nome_autor');
$tituloLivro = campo($_POST, 'titulo');

if ($nomeAutor === '' || $tituloLivro === '') {
    http_response_code(400);
    echo 'Nome do autor e título do livro são obrigatórios.';
    exit;
}

$slugAutor = limpar_nome_arquivo($nomeAutor);
$slugTitulo = limpar_nome_arquivo($tituloLivro);
$timestamp = date('Ymd-His');

$pastaSubmissao = $baseDir . DIRECTORY_SEPARATOR . $timestamp . '_' . $slugAutor . '_' . $slugTitulo;
garantir_pasta($pastaSubmissao);

$dados = [
    'Data da submissão' => date('d/m/Y H:i:s'),
    'Nome completo' => $nomeAutor,
    'Nome para publicação' => campo($_POST, 'nome_publicacao'),
    'E-mail' => campo($_POST, 'email'),
    'Telefone / WhatsApp' => campo($_POST, 'telefone'),
    'Endereço completo' => campo($_POST, 'endereco'),
    'Cidade' => campo($_POST, 'cidade'),
    'Estado' => campo($_POST, 'estado'),
    'País' => campo($_POST, 'pais'),
    'Site / ORCID / currículo / rede autoral' => campo($_POST, 'site_autor'),
    'Biografia do(a) autor(a)' => campo($_POST, 'bio_autor'),

    'Título do livro' => $tituloLivro,
    'Subtítulo' => campo($_POST, 'subtitulo'),
    'Idioma principal' => campo($_POST, 'idioma'),
    'Tipo de obra' => campo($_POST, 'tipo_obra'),
    'Categoria / área temática' => campo($_POST, 'categoria'),
    'Palavras-chave' => campo($_POST, 'palavras_chave'),
    'Faixa etária / público-alvo' => campo($_POST, 'faixa_etaria'),
    'Número da edição' => campo($_POST, 'edicao'),
    'Número estimado de páginas' => campo($_POST, 'paginas_estimadas'),
    'ISBN já existente?' => campo($_POST, 'isbn_existente'),
    'ISBN' => campo($_POST, 'isbn'),
    'Descrição / sinopse do livro' => campo($_POST, 'descricao'),

    'Declara autoria' => checkbox($_POST, 'declara_autoria'),
    'Declara originalidade' => checkbox($_POST, 'declara_originalidade'),
    'Declara direitos de imagem' => checkbox($_POST, 'declara_direitos_imagem'),
    'Declara direitos de tradução' => checkbox($_POST, 'declara_traducao'),
    'Detalhes sobre direitos' => campo($_POST, 'detalhes_direitos'),

    'Formato pretendido' => campo($_POST, 'formato_publicacao'),
    'Cor do miolo' => campo($_POST, 'miolo_cor'),
    'Acabamento de capa' => campo($_POST, 'acabamento_capa'),
    'Possui sangria?' => campo($_POST, 'sangria'),
    'Tamanho / trim size' => campo($_POST, 'tamanho_livro'),
    'Elementos internos especiais' => campo($_POST, 'acabamento_interno'),
    'Observações técnicas' => campo($_POST, 'sumario_observacoes'),

    'Preço sugerido do e-book' => campo($_POST, 'preco_sugerido_ebook'),
    'Preço sugerido do impresso' => campo($_POST, 'preco_sugerido_impresso'),
    'Descrição comercial para loja' => campo($_POST, 'descricao_amazon'),
    'Público-alvo e posicionamento editorial' => campo($_POST, 'publico_alvo'),

    'Observações sobre os arquivos' => campo($_POST, 'observacoes_arquivos'),

    'Aceite de avaliação editorial' => checkbox($_POST, 'aceite_avaliacao'),
    'Aceite de contato editorial' => checkbox($_POST, 'aceite_contato'),
];

$arquivoCapaFrontal = salvar_upload('capa_frontal', $pastaSubmissao, ['jpg','jpeg','png','pdf']);
$arquivoCapaTraseira = salvar_upload('capa_traseira', $pastaSubmissao, ['jpg','jpeg','png','pdf']);
$arquivoManuscrito = salvar_upload('manuscrito', $pastaSubmissao, ['doc','docx','pdf','odt']);

$dados['Arquivo capa frontal'] = $arquivoCapaFrontal ?? 'Não enviado ou inválido';
$dados['Arquivo capa traseira'] = $arquivoCapaTraseira ?? 'Não enviado ou inválido';
$dados['Arquivo manuscrito'] = $arquivoManuscrito ?? 'Não enviado ou inválido';

$txt = "";
foreach ($dados as $campoNome => $valor) {
    $txt .= $campoNome . ": " . $valor . PHP_EOL . PHP_EOL;
}

file_put_contents($pastaSubmissao . DIRECTORY_SEPARATOR . 'formulario-preenchido.txt', $txt);

$json = json_encode($dados, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
file_put_contents($pastaSubmissao . DIRECTORY_SEPARATOR . 'formulario-preenchido.json', (string)$json);

$linhasPdf = [];
foreach ($dados as $campoNome => $valor) {
    $linhasPdf[] = $campoNome . ': ' . $valor;
}

$arquivoPdf = $pastaSubmissao . DIRECTORY_SEPARATOR . 'formulario-preenchido.pdf';
$okPdf = gerar_pdf_simples($arquivoPdf, 'Submissao de Livro - Revista Inquietacoes Editorial', $linhasPdf);

?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Submissão enviada | Revista Inquietações Editorial</title>
  <style>
    body{
      font-family:Arial, Helvetica, sans-serif;
      background:#eef3fb;
      color:#1f2937;
      margin:0;
      padding:32px;
    }
    .box{
      max-width:860px;
      margin:0 auto;
      background:#fff;
      border:1px solid #d8e0f0;
      border-radius:20px;
      padding:28px;
      box-shadow:0 10px 30px rgba(23,48,109,.08);
    }
    h1{
      color:#17306d;
      margin-top:0;
    }
    p{
      line-height:1.7;
    }
    .success{
      background:#eef7f1;
      border:1px solid #cfe8d8;
      color:#1f5d38;
      border-radius:14px;
      padding:14px 16px;
      margin:18px 0;
    }
    .meta{
      background:#f8fbff;
      border:1px solid #d8e0f0;
      border-radius:14px;
      padding:16px;
      margin-top:18px;
    }
    a{
      display:inline-block;
      margin-top:18px;
      background:#1f3c88;
      color:#fff;
      text-decoration:none;
      padding:12px 18px;
      border-radius:12px;
      font-weight:700;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>Submissão recebida com sucesso</h1>

    <div class="success">
      Os dados do formulário foram processados e os arquivos enviados foram organizados em uma pasta da submissão.
    </div>

    <p><strong>Autor(a):</strong> <?= htmlspecialchars($nomeAutor, ENT_QUOTES, 'UTF-8') ?></p>
    <p><strong>Título do livro:</strong> <?= htmlspecialchars($tituloLivro, ENT_QUOTES, 'UTF-8') ?></p>

    <div class="meta">
      <p><strong>Pasta criada:</strong> <?= htmlspecialchars(basename($pastaSubmissao), ENT_QUOTES, 'UTF-8') ?></p>
      <p><strong>Capa frontal:</strong> <?= htmlspecialchars($dados['Arquivo capa frontal'], ENT_QUOTES, 'UTF-8') ?></p>
      <p><strong>Capa traseira:</strong> <?= htmlspecialchars($dados['Arquivo capa traseira'], ENT_QUOTES, 'UTF-8') ?></p>
      <p><strong>Manuscrito:</strong> <?= htmlspecialchars($dados['Arquivo manuscrito'], ENT_QUOTES, 'UTF-8') ?></p>
      <p><strong>PDF do formulário:</strong> <?= $okPdf ? 'Gerado com sucesso' : 'Não foi possível gerar o PDF' ?></p>
    </div>

    <a href="submissoes-de-livros.html">Voltar ao formulário</a>
  </div>
</body>
</html>