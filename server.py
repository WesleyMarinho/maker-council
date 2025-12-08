MAKER-Council MCP Server

Implementação do paper "MAKER: Massively Decomposed Agentic Processes"
usando FastMCP e Anthropic SDK.

Este servidor implementa um sistema de "council" onde múltiplos microagentes
(voters) geram propostas em paralelo, e um juiz sênior (judge) sintetiza
o consenso final.

import asyncio
import json
import os
from typing import Any

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastmcp import FastMCP

# Carregar variáveis de ambiente
load_dotenv()

# --- Configuração ---
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL")  # None usa o padrão da biblioteca
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "claude-3-5-sonnet-20241022")
VOTER_MODEL = os.getenv("VOTER_MODEL", "claude-3-haiku-20240307")

# Validação
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY não está definida no ambiente.")

# --- Cliente Anthropic Singleton ---
_client: AsyncAnthropic | None = None

def get_anthropic_client() -> AsyncAnthropic:
    """Retorna uma instância singleton do cliente AsyncAnthropic."""
    global _client
    if _client is None:
        kwargs: dict[str, Any] = {"api_key": ANTHROPIC_API_KEY}
        if ANTHROPIC_BASE_URL:
            kwargs["base_url"] = ANTHROPIC_BASE_URL
        _client = AsyncAnthropic(**kwargs)
    return _client

# --- Prompts do Sistema ---
VOTER_SYSTEM_PROMPT = """Você é um microagente focado em precisão técnica.
Analise a questão apresentada e forneça sua melhor solução.
Seja conciso, direto e técnico.
Responda apenas com a solução, sem preâmbulos ou explicações desnecessárias."""

JUDGE_SYSTEM_PROMPT = """Você é o Juiz Sênior do MAKER-Council.
Sua função é analisar múltiplas propostas de diferentes microagentes e determinar o melhor caminho a seguir.

REGRAS DE JULGAMENTO:
1. Se houver CONSENSO entre as propostas: Sintetize a melhor solução combinando os pontos fortes de cada uma.
2. Se houver DIVERGÊNCIA MENOR: Escolha a abordagem mais robusta e justifique brevemente.
3. Se houver DIVERGÊNCIA PERIGOSA (propostas contraditórias que podem causar bugs ou problemas de segurança): Retorne exatamente "RED FLAG" seguido de uma explicação do conflito.

Sempre estruture sua resposta final de forma clara e acionável."""

DECOMPOSER_SYSTEM_PROMPT = """Você é um especialista em decomposição de tarefas seguindo a metodologia MAKER.
Sua função é quebrar tarefas complexas em passos atômicos e acionáveis.

REGRAS DE DECOMPOSIÇÃO:
1. Cada passo deve ser uma ação única e verificável.
2. Passos devem ser sequenciais e ter dependências claras.
3. Evite passos vagos como "implementar funcionalidade" - seja específico.
4. Inclua passos de validação quando apropriado.

Retorne APENAS um JSON válido com a seguinte estrutura:
{
    "task": "descrição original da tarefa",
    "total_steps": número_de_passos,
    "steps": [
        {
            "step_number": 1,
            "action": "descrição da ação",
            "expected_output": "o que deve ser produzido",
            "dependencies": []
        }
    ]
}"""

# --- Inicialização do Servidor MCP ---
mcp = FastMCP(
    name="MAKER-Council",
    instructions="""
    Servidor MCP que implementa a metodologia MAKER para processos agênticos massivamente decompostos.
    
    Ferramentas disponíveis:
    - consult_council: Consulta múltiplos microagentes para verificar lógica ou gerar código seguro
    - decompose_task: Quebra tarefas complexas em passos atômicos
    """
)

# --- Funções Auxiliares ---
async def call_voter(client: AsyncAnthropic, query: str, voter_id: int) -> dict[str, Any]:
    """Executa uma chamada individual de voter com diversidade (temperature=0.7)."""
    try:
        response = await client.messages.create(
            model=VOTER_MODEL,
            max_tokens=2048,
            temperature=0.7,  # Diversidade nas respostas
            system=VOTER_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": query}
            ]
        )
        content = response.content[0].text if response.content else ""
        return {
            "voter_id": voter_id,
            "status": "success",
            "response": content,
            "model": VOTER_MODEL
        }
    except Exception as e:
        return {
            "voter_id": voter_id,
            "status": "error",
            "response": str(e),
            "model": VOTER_MODEL
        }

async def call_judge(client: AsyncAnthropic, query: str, voter_responses: list[dict]) -> str:
    """Executa a chamada do juiz para sintetizar as respostas dos voters."""
    # Formatar as respostas dos voters para o juiz
    formatted_responses = "\n\n".join([
        f"=== PROPOSTA DO MICROAGENTE {r['voter_id']} ===\n{r['response']}"
        for r in voter_responses
        if r["status"] == "success"
    ])
    
    judge_input = f"""QUESTÃO ORIGINAL:
{query}

PROPOSTAS DOS MICROAGENTES:
{formatted_responses}

Analise as propostas acima e forneça sua decisão final."""

    try:
        response = await client.messages.create(
            model=JUDGE_MODEL,
            max_tokens=4096,
            temperature=0.0,  # Determinístico para julgamento
            system=JUDGE_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": judge_input}
            ]
        )
        return response.content[0].text if response.content else "Erro: resposta vazia do juiz"
    except Exception as e:
        return f"Erro no julgamento: {str(e)}"

# --- Tools MCP ---
@mcp.tool(
    name="consult_council",
    description="""Consulta o MAKER-Council para verificar lógica ou gerar código seguro.
    
    Múltiplos microagentes (voters) analisam a questão em paralelo,
    e um juiz sênior sintetiza o consenso final.
    
    Ideal para:
    - Validar lógica de código
    - Gerar soluções robustas
    - Detectar potenciais problemas de segurança
    - Obter múltiplas perspectivas sobre um problema técnico
    """
)
async def consult_council(query: str, num_voters: int = 3) -> str:
    """Consulta múltiplos microagentes para verificar lógica ou gerar código seguro.
    
    Args:
        query: A questão ou código a ser analisado pelo council
        num_voters: Número de microagentes a consultar (padrão: 3, máximo: 10)
    
    Returns:
        A resposta sintetizada do Juiz Sênior
    """
    # Validação de parâmetros
    num_voters = max(1, min(num_voters, 10))  # Limitar entre 1 e 10
    
    client = get_anthropic_client()
    
    # Fase 1: Votação Paralela
    voter_tasks = [
        call_voter(client, query, voter_id=i + 1)
        for i in range(num_voters)
    ]
    voter_responses = await asyncio.gather(*voter_tasks)
    
    # Verificar se temos respostas válidas
    successful_responses = [r for r in voter_responses if r["status"] == "success"]
    if not successful_responses:
        return "Erro: Nenhum microagente conseguiu processar a consulta."
    
    # Fase 2: Julgamento (Consenso)
    judge_response = await call_judge(client, query, voter_responses)
    
    # Formatar resposta final
    result = f"""# MAKER-Council Report

## Configuração
- Voters consultados: {num_voters}
- Respostas bem-sucedidas: {len(successful_responses)}
- Modelo dos Voters: {VOTER_MODEL}
- Modelo do Juiz: {JUDGE_MODEL}

## Decisão Final do Juiz

{judge_response}
"""
    return result

@mcp.tool(
    name="decompose_task",
    description="""Decompõe tarefas complexas em passos atômicos e acionáveis.
    
    Segue a metodologia MAKER de decomposição extrema, onde cada passo
    é uma ação única, verificável e com dependências claras.
    
    Ideal para:
    - Planejar implementações complexas
    - Criar roadmaps técnicos
    - Dividir épicos em tarefas menores
    - Estruturar processos de desenvolvimento
    """
)
async def decompose_task(task: str) -> str:
    """Quebra tarefas complexas em passos atômicos.
    
    Args:
        task: A tarefa complexa a ser decomposta
    
    Returns:
        JSON string com a lista de passos seguindo a metodologia MAKER
    """
    client = get_anthropic_client()
    
    try:
        response = await client.messages.create(
            model=JUDGE_MODEL,  # Usa o modelo inteligente para decomposição
            max_tokens=4096,
            temperature=0.0,  # Determinístico para estrutura
            system=DECOMPOSER_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": f"Decomponha a seguinte tarefa:\n\n{task}"}
            ]
        )
        
        content = response.content[0].text if response.content else "{}"
        
        # Tentar extrair JSON da resposta
        # O modelo pode incluir markdown code blocks
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            content = content[start:end].strip()
        elif "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            content = content[start:end].strip()
        
        # Validar que é JSON válido
        try:
            parsed = json.loads(content)
            return json.dumps(parsed, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            # Se não for JSON válido, retornar a resposta raw com wrapper
            return json.dumps({
                "task": task,
                "raw_response": content,
                "error": "Resposta não estava em formato JSON válido"
            }, indent=2, ensure_ascii=False)
            
    except Exception as e:
        return json.dumps({
            "task": task,
            "error": str(e),
            "total_steps": 0,
            "steps": []
        }, indent=2, ensure_ascii=False)

# --- Ponto de Entrada ---
if __name__ == "__main__":
    mcp.run()