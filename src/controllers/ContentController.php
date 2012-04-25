<?php
namespace Blocks;

/**
 * Handles content management tasks
 */
class ContentController extends Controller
{
	/**
	 * All content actions require the user to be logged in
	 */
	public function init()
	{
		$this->requireLogin();
	}

	/**
	 * Saves a section
	 */
	public function actionSaveSection()
	{
		$this->requirePostRequest();

		$sectionSettings['name']        = b()->request->getPost('name');
		$sectionSettings['handle']      = b()->request->getPost('handle');
		$sectionSettings['max_entries'] = b()->request->getPost('max_entries');
		$sectionSettings['sortable']    = b()->request->getPost('sortable');
		$sectionSettings['has_urls']    = b()->request->getPost('has_urls');
		$sectionSettings['url_format']  = b()->request->getPost('url_format');
		$sectionSettings['template']    = b()->request->getPost('template');
		$sectionSettings['blocks']      = b()->request->getPost('blocks');

		$sectionId = b()->request->getPost('section_id');

		$section = b()->content->saveSection($sectionSettings, $sectionId);

		// Did it save?
		if (!$section->errors)
		{
			// Did all of the blocks save?
			$blocksSaved = true;
			foreach ($section->blocks as $block)
			{
				if ($block->errors)
				{
					$blocksSaved = false;
					break;
				}
			}

			if ($blocksSaved)
			{
				b()->user->setMessage(MessageType::Notice, 'Section saved.');

				$url = b()->request->getPost('redirect');
				if ($url !== null)
					$this->redirect($url);
			}
			else
				b()->user->setMessage(MessageType::Error, 'Section saved, but couldn’t save all the content blocks.');
		}
		else
			b()->user->setMessage(MessageType::Error, 'Couldn’t save section.');


		// Reload the original template
		$this->loadRequestedTemplate(array(
			'section' => $section
		));
	}

	/**
	 * Creates a new entry and returns its edit page
	 */
	public function actionCreateEntry()
	{
		$this->requirePostRequest();
		$this->requireAjaxRequest();

		$sectionId = b()->request->getRequiredPost('sectionId');
		$title     = b()->request->getPost('title');

		// Create the entry
		$entry = b()->content->createEntry($sectionId, null, null, $title);

		// Save its slug
		if ($entry->section->has_urls)
			b()->content->saveEntrySlug($entry, strtolower($title));

		// Create the first draft
		$entry->draft = b()->content->createDraft($entry->id, null, 'Draft 1');

		$this->returnEntryJson($entry);
	}

	/**
	 * Saves an entry.
	 */
	public function actionSaveEntry()
	{
		$this->requirePostRequest();

		// Get the entry
		$entryId = b()->request->getRequiredPost('entryId');
		$entry = b()->content->getEntryById($entryId);
		if (!$entryId)
			throw new Exception('No entry exists with the ID '.$entryId);

		// Save the new content
		$changes = $this->getEntryChangesFromPost($entry);
		if (b()->content->saveEntryContent($entry, $changes))
		{
			b()->user->setMessage(MessageType::Notice, 'Entry saved.');

			$url = b()->request->getPost('redirect');
			if ($url !== null)
				$this->redirect($url);
		}
		else
		{
			b()->user->setMessage(MessageType::Error, 'Couldn’t save entry.');
		}

		$this->loadRequestedTemplate(array('entry' => $entry));
	}

	/**
	 * Creates a new draft.
	 */
	public function actionCreateDraft()
	{
		$this->requirePostRequest();

		$entryId = b()->request->getRequiredPost('entryId');

		$entry = b()->content->getEntryById($entryId);
		if (!$entry)
			throw new Exception('No entry exists with the ID '.$entryId);

		$changes = $this->getEntryChangesFromPost($entry);
		$draftName = b()->request->getPost('draftName');
		$draft = b()->content->createEntryVersion($entry, true, $changes, $draftName);

		$this->redirect("content/edit/{$entry->id}/draft{$draft->num}");
	}

	/**
	 * Returns any entry changes in the post data
	 * @access private
	 * @param  Entry $entry
	 * @return array
	 */
	private function getEntryChangesFromPost($entry)
	{
		$changes = array();

		if (($title = b()->request->getPost('title')) !== null)
			$changes['title'] = $title;

		foreach ($entry->blocks as $block)
			if (($val = b()->request->getPost($block->handle)) !== null)
				$changes[$block->handle] = $val;

		return $changes;
	}




	/**
	 * Loads an entry
	 */
	public function actionLoadEntryEditPage()
	{
		$this->requirePostRequest();
		$this->requireAjaxRequest();

		$entryId = b()->request->getRequiredPost('entryId');

		$entry = b()->content->getEntryById($entryId);
		if (!$entry)
			$this->returnErrorJson('No entry exists with the ID '.$entryId);

		// Is there a requested draft?
		$draftNum = b()->request->getPost('draftNum');
		if ($draftNum)
			$draft = b()->content->getDraftByNum($entryId, $draftNum);

		// We must fetch a draft if the entry hasn't been published
		if (empty($draft) && !$entry->published)
		{
			$draft = b()->content->getLatestDraft($entry->id);
			if (!$draft)
				$draft = b()->content->createDraft($entry->id);
		}

		if (!empty($draft))
			$entry->draft = $draft;

		$this->returnEntryEditPage($entry);
	}

	/**
	 * Autosaves a draft
	 */
	public function actionAutosaveDraft()
	{
		$this->requirePostRequest();
		$this->requireAjaxRequest();

		$entryId = b()->request->getRequiredPost('entryId');
		$entry = b()->content->getEntryById($entryId);
		if (!$entryId)
			$this->returnErrorJson('No entry exists with the ID '.$entryId);

		$content = b()->request->getRequiredPost('content');

		// Get the draft, or create a new one
		$draftId = b()->request->getPost('draftId');
		if ($draftId)
		{
			$draft = b()->content->getDraftById($draftId);
			if (!$draft)
				$this->returnErrorJson('No draft exists with the ID '.$draftId);
		}
		else
			$draft = b()->content->createDraft($entryId);

		// Save the new draft content
		b()->content->saveDraftChanges($draft, $content);

		$entry->draft = $draft;
		$this->returnEntryJson($entry);
	}

	/**
	 * Publishes a draft
	 */
	public function actionPublishDraft()
	{
		$this->requirePostRequest();
		$this->requireAjaxRequest();

		$entryId = b()->request->getRequiredPost('entryId');
		$entry = b()->content->getEntryById($entryId);
		if (!$entryId)
			$this->returnErrorJson('No entry exists with the ID '.$entryId);

		$draftId = b()->request->getPost('draftId');
		if ($draftId)
		{
			$draft = b()->content->getDraftById($draftId);
			if (!$draft)
				$this->returnErrorJson('No draft exists with the ID '.$draftId);
		}
		else
			$draft = b()->content->createDraft($entryId);

		// Save any last-minute content changes
		$content = b()->request->getPost('content');
		if ($content)
			b()->content->saveDraftChanges($draft, $content);

		// Publish it
		b()->content->publishDraft($entry, $draft);

		$this->returnEntryJson($entry);
	}

	/**
	 * Returns entry data used by Entry.js.
	 * @access private
	 * @param Entry $entry
	 * @param array $return Any additional values to return.
	 */
	private function returnEntryJson($entry, $return = array())
	{
		$return['entryData']['entryId']     = $entry->id;
		$return['entryData']['entryTitle']  = $entry->title;
		$return['entryData']['entryStatus'] = $entry->status;

		if ($entry->draft)
		{
			$return['entryData']['draftId']     = $entry->draft->id;
			$return['entryData']['draftNum']    = $entry->draft->num;
			$return['entryData']['draftName']   = $entry->draft->name;
			$return['entryData']['draftAuthor'] = $entry->draft->author->firstNameLastInitial;
		}
		else
		{
			$return['entryData']['draftId']     = null;
			$return['entryData']['draftNum']    = null;
			$return['entryData']['draftName']   = null;
			$return['entryData']['draftAuthor'] = null;
		}

		$return['success'] = true;
		$this->returnJson($return);
	}

	/**
	 * Returns an entry edit page.
	 * @access private
	 * @param Entry $entry
	 */
	private function returnEntryEditPage($entry)
	{
		$return['entryHtml']  = $this->loadTemplate('content/_includes/entry', array('entry' => $entry), true);
		$this->returnEntryJson($entry, $return);
	}
}
