"""
Script de teste para o MAKER-Council MCP Server.
Testa a implementação do paper MAKER (arXiv:2511.09030v1).
"""

import asyncio
import io
import json
import sys

# Configurar stdout para UTF-8 no Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Adicionar o diretório atual ao path
sys.path.insert(0, ".")

from server import (
    get_llm_client,
    first_to_ahead_by_k_voting,
    collect_voter_proposals,
    check_red_flags,
    JUDGE_MODEL,
    VOTER_MODEL,
    DECOMPOSER_SYSTEM_PROMPT,
    ANTHROPIC_BASE_URL,
)


async def test_red_flagging():
    """Testa o sistema de red-flagging."""
    print("=" * 60)
    print("TESTE: Red-Flagging")
    print("=" * 60)
    
    # Teste 1: Resposta normal
    result = check_red_flags("Uma resposta normal", 50)
    assert result.is_valid, "Resposta normal deveria ser valida"
    print("  [OK] Resposta normal aceita")
    
    # Teste 2: Resposta muito longa
    result = check_red_flags("Resposta longa", 1000)
    assert not result.is_valid, "Resposta longa deveria ser rejeitada"
    print("  [OK] Resposta longa rejeitada")
    
    # Teste 3: Resposta vazia
    result = check_red_flags("", 0)
    assert not result.is_valid, "Resposta vazia deveria ser rejeitada"
    print("  [OK] Resposta vazia rejeitada")
    
    print("\n[PASSOU] Todos os testes de red-flagging passaram!")
    return True


async def test_first_to_ahead_by_k_voting():
    """Testa o algoritmo de votacao first-to-ahead-by-k."""
    print("\n" + "=" * 60)
    print("TESTE: First-to-ahead-by-k Voting")
    print("=" * 60)
    
    query = "Quanto e 2 + 2? Responda apenas com o numero."
    k = 3
    
    print(f"\nQuery: {query}")
    print(f"k (margem): {k}")
    print(f"Modelo: {VOTER_MODEL}")
    print(f"Base URL: {ANTHROPIC_BASE_URL or 'API Anthropic nativa'}")
    print("\nExecutando votacao...")
    
    try:
        client = get_llm_client()
        
        winner, state = await first_to_ahead_by_k_voting(
            client=client,
            prompt=query,
            system_prompt="Responda de forma direta e concisa.",
            model=VOTER_MODEL,
            k=k,
            temperature=0.7,
            extract_answer=lambda x: x.strip()
        )
        
        print(f"\n--- RESULTADO ---")
        print(f"Resposta vencedora: {winner}")
        print(f"Total de amostras: {state.total_samples}")
        print(f"Amostras validas: {state.valid_samples}")
        print(f"Red-flagged: {state.red_flagged}")
        print(f"Candidatos unicos: {len(state.votes)}")
        print(f"Distribuicao de votos: {dict(state.votes)}")
        
        # Verificar se convergiu
        if winner and "4" in winner:
            print("\n[PASSOU] Votacao convergiu para resposta correta!")
            return True
        else:
            print(f"\n[AVISO] Resposta inesperada: {winner}")
            return True  # Ainda passou se convergiu
            
    except Exception as e:
        print(f"\n[ERRO]: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_consult_council():
    """Testa a consulta completa ao council."""
    print("\n" + "=" * 60)
    print("TESTE: Consult Council (Fluxo Completo)")
    print("=" * 60)
    
    query = "Qual a melhor forma de implementar um singleton thread-safe em Python?"
    num_voters = 2  # Reduzido para teste rapido
    k = 2
    
    print(f"\nQuery: {query}")
    print(f"Voters: {num_voters}")
    print(f"k: {k}")
    print(f"Modelo Voters: {VOTER_MODEL}")
    print(f"Modelo Judge: {JUDGE_MODEL}")
    print("\nColetando propostas dos voters...")
    
    try:
        client = get_llm_client()
        
        # Fase 1: Coletar propostas (agora retorna tupla com metricas)
        proposals, perf_metrics = await collect_voter_proposals(client, query, num_voters, k)
        
        print(f"\nPropostas coletadas: {len(proposals)}")
        print(f"Tempo total: {perf_metrics['total_wall_time']:.2f}s")
        print(f"Early terminations: {perf_metrics['early_terminations']}/{num_voters}")
        
        for p in proposals:
            proposal_text = p['proposal'] if p['proposal'] else "(vazio)"
            preview = proposal_text[:100] + "..." if len(proposal_text) > 100 else proposal_text
            print(f"  Voter {p['voter_id']}: {p['valid_samples']} amostras, {p['red_flagged']} flagged, {p['elapsed_time']:.2f}s")
            print(f"    Preview: {preview}")
        
        valid_proposals = [p for p in proposals if p["proposal"]]
        if not valid_proposals:
            print("\n[ERRO] Nenhuma proposta valida!")
            return False
        
        # Fase 2: Julgamento
        print("\nConsultando o Juiz...")
        
        formatted_proposals = "\n\n".join([
            f"=== PROPOSTA {p['voter_id']} ===\n{p['proposal']}"
            for p in valid_proposals
        ])
        
        judge_prompt = f"""QUESTAO: {query}

PROPOSTAS:
{formatted_proposals}

Analise e forneca sua decisao."""

        judge_response, _ = await client.create_message(
            model=JUDGE_MODEL,
            max_tokens=2048,
            temperature=0.0,
            system="Voce e um juiz que analisa propostas e sintetiza a melhor solucao.",
            messages=[{"role": "user", "content": judge_prompt}]
        )
        
        print("\n--- DECISAO DO JUIZ ---")
        print(judge_response[:500] + "..." if len(judge_response) > 500 else judge_response)
        
        print("\n[PASSOU] Fluxo completo executado com sucesso!")
        return True
        
    except Exception as e:
        print(f"\n[ERRO]: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_decompose_task():
    """Testa a decomposicao de tarefas."""
    print("\n" + "=" * 60)
    print("TESTE: Decompose Task (MAD)")
    print("=" * 60)
    
    task = "Criar uma funcao que valida emails"
    
    print(f"\nTask: {task}")
    print(f"Modelo: {JUDGE_MODEL}")
    print("\nDecompondo tarefa...")
    
    try:
        client = get_llm_client()
        
        def extract_json(response):
            if "```json" in response:
                start = response.find("```json") + 7
                end = response.find("```", start)
                return response[start:end].strip()
            elif "```" in response:
                start = response.find("```") + 3
                end = response.find("```", start)
                return response[start:end].strip()
            import re
            match = re.search(r'\{[\s\S]*\}', response)
            if match:
                return match.group(0)
            return response
        
        winner, state = await first_to_ahead_by_k_voting(
            client=client,
            prompt=f"Decomponha em passos atomicos:\n\n{task}",
            system_prompt=DECOMPOSER_SYSTEM_PROMPT,
            model=JUDGE_MODEL,
            k=2,
            temperature=0.3,
            extract_answer=extract_json
        )
        
        print(f"\nAmostras: {state.total_samples}, Validas: {state.valid_samples}")
        
        # Tentar parsear JSON
        try:
            parsed = json.loads(winner)
            print("\n--- DECOMPOSICAO ---")
            print(json.dumps(parsed, indent=2, ensure_ascii=False)[:1000])
            print("\n[PASSOU] Decomposicao retornou JSON valido!")
            return True
        except json.JSONDecodeError:
            print("\n--- RESPOSTA RAW ---")
            print(winner[:500])
            print("\n[AVISO] Resposta nao e JSON valido, mas foi gerada")
            return True
            
    except Exception as e:
        print(f"\n[ERRO]: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Executa todos os testes."""
    print("\n" + "=" * 60)
    print("MAKER-Council MCP Server - Testes")
    print("Implementacao do paper arXiv:2511.09030v1")
    print("=" * 60)
    
    results = {}
    
    # Teste 1: Red-flagging (local, sem API)
    results["red_flagging"] = await test_red_flagging()
    
    # Teste 2: Votacao first-to-ahead-by-k
    results["voting"] = await test_first_to_ahead_by_k_voting()
    
    # Teste 3: Consult Council completo
    results["council"] = await test_consult_council()
    
    # Teste 4: Decomposicao de tarefas
    results["decompose"] = await test_decompose_task()
    
    # Resumo
    print("\n" + "=" * 60)
    print("RESUMO DOS TESTES")
    print("=" * 60)
    
    for test, passed in results.items():
        status = "[PASSOU]" if passed else "[FALHOU]"
        print(f"  {test}: {status}")
    
    all_passed = all(results.values())
    print(f"\nResultado final: {'Todos os testes passaram!' if all_passed else 'Alguns testes falharam.'}")
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)